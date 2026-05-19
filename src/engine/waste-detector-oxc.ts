import type { Function as OxcFunction, Node } from 'oxc-parser';

import { buildLineOffsets, getLineColumn } from '@zipbul/gildash';

import type { WasteFinding } from '..';
import type { BitSet, ParsedFile } from './types';

import { collectOxcNodes, forEachChildNode, getNodeName, isFunctionNode, isOxcNode } from './ast';
import { analyzeFunctionBody, collectLocalVarIndexes, collectParameterBindings, collectVariables } from './dataflow';

interface NestedFunctionContext {
  readonly entryNodeIds: number[];
  readonly readNamesByEntryNodeId: Map<number, Set<string>>;
}

const addClosureReadsFromFunction = (nestedFunction: Node, closureReadNames: Set<string>, entryReadNames: Set<string>): void => {
  const nestedReads = collectVariables(nestedFunction, { includeNestedFunctions: true }).filter(u => u.isRead);

  for (const r of nestedReads) {
    if (closureReadNames.has(r.name)) {
      entryReadNames.add(r.name);
    }
  }
};

const isRelevantNestedFunction = (nestedFunction: Node, outerReadNames: Set<string>): boolean => {
  if (nestedFunction.type !== 'FunctionDeclaration') {
    return true;
  }

  const nestedFn = nestedFunction as OxcFunction;
  const declName = getNodeName(nestedFn.id);

  return declName === null || outerReadNames.has(declName);
};

const buildEntryContext = (
  nested: Node[],
  outerReadNames: Set<string>,
  closureReadNames: Set<string>,
): { hasRelevant: boolean; entryReadNames: Set<string> } => {
  let hasRelevant = false;
  const entryReadNames = new Set<string>();

  for (const nestedFunction of nested) {
    if (!isRelevantNestedFunction(nestedFunction, outerReadNames)) {
      continue;
    }

    hasRelevant = true;

    addClosureReadsFromFunction(nestedFunction, closureReadNames, entryReadNames);
  }

  return { hasRelevant, entryReadNames };
};

const buildNestedFunctionContext = (
  nodePayloads: ReadonlyArray<Node | ReadonlyArray<Node> | undefined>,
  outerReadNames: Set<string>,
  closureReadNames: Set<string>,
): NestedFunctionContext => {
  const entryNodeIds: number[] = [];
  const readNamesByEntryNodeId = new Map<number, Set<string>>();

  for (let nodeId = 0; nodeId < nodePayloads.length; nodeId += 1) {
    const payload = nodePayloads[nodeId];

    if (!payload) {
      continue;
    }

    const payloadNodes: ReadonlyArray<Node> = Array.isArray(payload) ? (payload as ReadonlyArray<Node>) : [payload as Node];
    const nested = payloadNodes.flatMap(pn => collectOxcNodes(pn, n => isFunctionNode(n)));

    if (nested.length === 0) {
      continue;
    }

    const { hasRelevant, entryReadNames } = buildEntryContext(nested, outerReadNames, closureReadNames);

    if (!hasRelevant) {
      continue;
    }

    entryNodeIds.push(nodeId);
    readNamesByEntryNodeId.set(nodeId, entryReadNames);
  }

  return { entryNodeIds, readNamesByEntryNodeId };
};

const isDefClosureCaptured = (
  defId: number,
  metaName: string,
  nestedCtx: NestedFunctionContext,
  reachingInByNode: ReadonlyArray<BitSet>,
): boolean => {
  for (const entryNodeId of nestedCtx.entryNodeIds) {
    const entryReadNames = nestedCtx.readNamesByEntryNodeId.get(entryNodeId);

    if (!entryReadNames || !entryReadNames.has(metaName)) {
      continue;
    }

    const reaching = reachingInByNode[entryNodeId];

    if (reaching && reaching.has(defId)) {
      return true;
    }
  }

  return false;
};

const buildWasteFinding = (
  metaName: string,
  metaLocation: number,
  isOverwritten: boolean,
  writeKind: string | undefined,
  filePath: string,
  lineOffsets: number[],
): WasteFinding => {
  const loc = getLineColumn(lineOffsets, metaLocation);
  const kind = isOverwritten && writeKind !== 'declaration' ? 'dead-store-overwrite' : 'dead-store';
  const message =
    kind === 'dead-store-overwrite'
      ? `Variable '${metaName}' is assigned but overwritten before being read`
      : `Variable '${metaName}' is assigned but never read`;

  return {
    kind,
    label: metaName,
    message,
    filePath,
    span: {
      start: loc,
      end: {
        line: loc.line,
        column: loc.column + metaName.length,
      },
    },
  };
};

const collectWasteFindingsForFunction = (
  node: Node,
  functionBodyNode: Node | ReadonlyArray<Node>,
  filePath: string,
  lineOffsets: number[],
  findings: WasteFinding[],
): void => {
  const localIndexByName = collectLocalVarIndexes(node);
  const parameterBindings = collectParameterBindings(node);

  if (localIndexByName.size === 0) {
    return;
  }

  // Collect parameter default expressions (the right-hand side of `AssignmentPattern`).
  // Identifier reads inside defaults are use-sites for earlier parameters and must be
  // surfaced to the dataflow analysis so `function f(a=1, b=a)` doesn't flag `a` as dead.
  const fnParams = (node as OxcFunction).params;
  const parameterDefaults: Node[] = [];

  for (const param of fnParams) {
    if (param.type === 'AssignmentPattern') {
      parameterDefaults.push(param.right);
    }
  }

  const analysis = analyzeFunctionBody(functionBodyNode, localIndexByName, parameterBindings, parameterDefaults);
  const { defs, usedDefs, overwrittenDefIds, reachingInByNode, nodePayloads } = analysis;
  const functionBodyNodes: ReadonlyArray<Node> = Array.isArray(functionBodyNode)
    ? (functionBodyNode as ReadonlyArray<Node>)
    : [functionBodyNode as Node];
  const allReads = functionBodyNodes.flatMap(n => collectVariables(n, { includeNestedFunctions: true })).filter(u => u.isRead);
  const outerReads = functionBodyNodes.flatMap(n => collectVariables(n, { includeNestedFunctions: false })).filter(u => u.isRead);
  const outerReadKeys = new Set(outerReads.map(u => `${u.name}@${u.location}`));
  const closureReadNames = new Set(allReads.filter(u => !outerReadKeys.has(`${u.name}@${u.location}`)).map(u => u.name));
  const outerReadNames = new Set(outerReads.map(u => u.name));
  const nestedCtx = buildNestedFunctionContext(
    nodePayloads as ReadonlyArray<Node | ReadonlyArray<Node> | undefined>,
    outerReadNames,
    closureReadNames,
  );
  // Deduplicate findings by (name, source location). The CFG may model the same
  // source-level write more than once (e.g. finally bodies are duplicated for the
  // normal- and abnormal-completion paths), producing distinct defIds at the same
  // offset. Without this guard the same dead-store is emitted multiple times.
  const emittedKeys = new Set<string>();

  for (let defId = 0; defId < defs.length; defId += 1) {
    if (usedDefs.has(defId)) {
      continue;
    }

    const meta = defs[defId];

    if (!meta) {
      continue;
    }

    if (isDefClosureCaptured(defId, meta.name, nestedCtx, reachingInByNode)) {
      continue;
    }

    // Binding-only declarations (`let x;`) create a binding but do not write a value.
    // reaching-defs registers them for other detectors (e.g. variable-lifetime), but
    // waste must not flag them as dead — there is no value to be dead in the first place.
    if (meta.writeKind === 'declaration' && meta.hasInit === false) {
      continue;
    }

    // `using` / `await using` declarations bind a resource whose disposal at scope exit
    // is the observable behavior (CLAUDE.md K example: "자원 핸들 lifetime").
    if (meta.declarationKind === 'using' || meta.declarationKind === 'await using') {
      continue;
    }

    const dedupeKey = `${meta.name}@${meta.location}`;

    if (emittedKeys.has(dedupeKey)) {
      continue;
    }

    emittedKeys.add(dedupeKey);

    findings.push(
      buildWasteFinding(meta.name, meta.location, overwrittenDefIds[defId] === true, meta.writeKind, filePath, lineOffsets),
    );
  }
};

export const detectWasteOxc = (files: ParsedFile[]): WasteFinding[] => {
  const findings: WasteFinding[] = [];

  if (!Array.isArray(files)) {
    return [];
  }

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const lineOffsets = buildLineOffsets(file.sourceText);

    const visit = (node: Node | ReadonlyArray<Node> | undefined): void => {
      if (Array.isArray(node)) {
        for (const entry of node as ReadonlyArray<Node>) {
          visit(entry);
        }

        return;
      }

      if (!isOxcNode(node)) {
        return;
      }

      const fn = node as OxcFunction;
      const functionBodyNode = isFunctionNode(node) ? (fn.body ?? undefined) : undefined;

      if (isFunctionNode(node) && functionBodyNode !== undefined) {
        collectWasteFindingsForFunction(node, functionBodyNode, file.filePath, lineOffsets, findings);
      }

      forEachChildNode(node, child => visit(child));
    };

    visit(file.program);
  }

  return findings;
};
