import type { Function as OxcFunction, Node } from 'oxc-parser';

import { buildLineOffsets, getLineColumn } from '@zipbul/gildash';

import type { WasteFinding } from '..';
import type { BitSet, ParsedFile } from './types';

import { collectOxcNodes, forEachChildNode, isFunctionNode, isOxcNode } from './ast';
import { analyzeFunctionBody, bindingKey, collectLocalVarIndexes, collectParameterBindings, collectVariables } from './dataflow';
import { buildDeclScopeMap } from './dataflow/variable-collector';

interface NestedFunctionContext {
  /**
   * CFG node ids whose payload includes one or more nested functions. The CFG
   * delivers a nested function's body as a single payload reachable from its
   * declaration site, so each entryNodeId stands for "control reached a closure
   * that can fire at any time after this point."
   */
  readonly entryNodeIds: number[];
  /**
   * For each entry, the *outer* binding `varIndex`es that the nested function (or
   * its own nested functions, transitively) reads. A def whose `varIndex` is in
   * this set and whose `defId` reaches the entry is closure-captured.
   */
  readonly capturedVarIndexesByEntry: Map<number, Set<number>>;
}

/**
 * Collect outer-binding varIndexes that this nested function captures by reading.
 *
 * "Outer" is decided by varIndex membership in `localIndexByName`, which is keyed
 * by `bindingKey(name, declScope)` — same-named inner shadows resolve to a
 * different scope and therefore are never registered as outer bindings. This is
 * why the closure check is bindingKey-driven rather than name-driven.
 */
const collectCapturedVarIndexesFromFunction = (
  nestedFunction: Node,
  localIndexByName: Map<string, number>,
  declScopeByIdLocation: ReadonlyMap<number, string>,
  out: Set<number>,
): void => {
  const nestedUsages = collectVariables(nestedFunction, { includeNestedFunctions: true, declScopeByIdLocation });

  for (const u of nestedUsages) {
    if (!u.isRead) {
      continue;
    }

    const idx = localIndexByName.get(bindingKey(u.name, u.declScope));

    if (typeof idx === 'number') {
      out.add(idx);
    }
  }
};

const buildNestedFunctionContext = (
  nodePayloads: ReadonlyArray<Node | ReadonlyArray<Node> | undefined>,
  localIndexByName: Map<string, number>,
  declScopeByIdLocation: ReadonlyMap<number, string>,
): NestedFunctionContext => {
  const entryNodeIds: number[] = [];
  const capturedVarIndexesByEntry = new Map<number, Set<number>>();

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

    const captured = new Set<number>();

    for (const nestedFunction of nested) {
      collectCapturedVarIndexesFromFunction(nestedFunction, localIndexByName, declScopeByIdLocation, captured);
    }

    if (captured.size === 0) {
      continue;
    }

    entryNodeIds.push(nodeId);
    capturedVarIndexesByEntry.set(nodeId, captured);
  }

  return { entryNodeIds, capturedVarIndexesByEntry };
};

const isDefClosureCaptured = (
  defId: number,
  varIndex: number,
  nestedCtx: NestedFunctionContext,
  reachingInByNode: ReadonlyArray<BitSet>,
): boolean => {
  for (const entryNodeId of nestedCtx.entryNodeIds) {
    const capturedSet = nestedCtx.capturedVarIndexesByEntry.get(entryNodeId);

    if (!capturedSet || !capturedSet.has(varIndex)) {
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

  // Build the decl-scope map from the function root so parameter declarations are
  // visible to the in-body walks (`ScopeTracker.getDeclaration` cannot resolve
  // parameters when the walk starts at the body).
  const declScopeByIdLocation = buildDeclScopeMap(node);
  const analysis = analyzeFunctionBody(
    functionBodyNode,
    localIndexByName,
    parameterBindings,
    parameterDefaults,
    declScopeByIdLocation,
  );
  const { defs, usedDefs, overwrittenDefIds, reachingInByNode, nodePayloads } = analysis;
  // CLAUDE.md 비대상: function parameter. The reaching-defs seed for parameter bindings
  // is still needed so reads inside the body resolve to a definition, but the detector
  // must never report parameters themselves as waste.
  const parameterLocations = new Set<number>();

  for (const binding of parameterBindings) {
    parameterLocations.add(binding.location);
  }
  const functionBodyNodes: ReadonlyArray<Node> = Array.isArray(functionBodyNode)
    ? (functionBodyNode as ReadonlyArray<Node>)
    : [functionBodyNode as Node];
  // Syntactic read counting (ignores static dead-branch pruning) to classify
  // "사용처 0회 변수 (no-unused-vars 영역)" correctly. Includes reads inside nested
  // functions so closure captures count as syntactic uses of the outer binding.
  const syntacticReads = functionBodyNodes
    .flatMap(n => collectVariables(n, { includeNestedFunctions: true, declScopeByIdLocation, evaluateAllBranches: true }))
    .filter(u => u.isRead);
  // Closure-capture analysis is varIndex-driven: a read inside a nested function only
  // counts as capturing an *outer* binding if `bindingKey(name, declScope)` resolves
  // to an entry in `localIndexByName` — inner same-name shadows resolve to a different
  // scope key and are filtered out automatically.
  const nestedCtx = buildNestedFunctionContext(
    nodePayloads as ReadonlyArray<Node | ReadonlyArray<Node> | undefined>,
    localIndexByName,
    declScopeByIdLocation,
  );
  // CLAUDE.md 비대상: 사용처 0회 변수 (no-unused-vars 영역).
  // A binding with zero syntactic reads belongs to no-unused-vars, not waste.
  // `syntacticReads` ignores static dead-branch pruning, matching how tsc's
  // `noUnusedLocals` classifies variables — a read in `1 ?? fallback` still counts.
  const varHasAnyRead = new Set<number>();

  for (const usage of syntacticReads) {
    const idx = localIndexByName.get(bindingKey(usage.name, usage.declScope));

    if (typeof idx === 'number') {
      varHasAnyRead.add(idx);
    }
  }

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

    // CLAUDE.md "함수 파라미터" 비대상.
    if (parameterLocations.has(meta.location)) {
      continue;
    }

    // CLAUDE.md "사용처 0회 변수 (no-unused-vars 영역)" 비대상.
    if (!varHasAnyRead.has(meta.varIndex)) {
      continue;
    }

    if (isDefClosureCaptured(defId, meta.varIndex, nestedCtx, reachingInByNode)) {
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
