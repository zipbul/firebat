import { is } from '@zipbul/gildash';
import type { Function as OxcFunction, Node } from 'oxc-parser';

import { buildLineOffsets, getLineColumn } from '@zipbul/gildash';

import type { WasteFinding } from '..';
import type { ParsedFile } from './types';

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
  if (!is.FunctionDeclaration(nestedFunction)) {
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
  reachingInByNode: ReadonlyArray<ReadonlySet<number> | undefined>,
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

const buildVarHasAnyUsedDef = (
  defs: ReadonlyArray<{ varIndex: number } | undefined>,
  usedDefs: { has(n: number): boolean },
  varCount: number,
): boolean[] => {
  const varHasAnyUsedDef: boolean[] = Array.from({ length: varCount }, () => false);

  for (let defId = 0; defId < defs.length; defId += 1) {
    if (!usedDefs.has(defId)) {
      continue;
    }

    const meta = defs[defId];

    if (meta) {
      varHasAnyUsedDef[meta.varIndex] = true;
    }
  }

  return varHasAnyUsedDef;
};

/**
 * Map each def to the start offset of the lexical scope that owns its binding.
 * The binding's scope is the innermost block (or the function body) that declares
 * the variable with `let`/`const` — an assignment writes to that binding regardless
 * of where the assignment textually appears. Two defs with different scope offsets
 * therefore refer to different bindings (i.e. one shadows the other).
 */
const buildScopeMapForFunctionBody = (
  body: Node | ReadonlyArray<Node>,
  defs: ReadonlyArray<{ name: string; location: number } | undefined>,
): ReadonlyArray<number> => {
  const bodies: ReadonlyArray<Node> = Array.isArray(body) ? (body as ReadonlyArray<Node>) : [body as Node];

  // Per name: list of [scopeStart, scopeEnd) ranges in which a `let`/`const` declares it.
  const declScopesByName = new Map<string, Array<{ start: number; end: number }>>();

  const recordDeclarationScope = (name: string, scope: { start: number; end: number }): void => {
    let list = declScopesByName.get(name);

    if (!list) {
      list = [];
      declScopesByName.set(name, list);
    }

    list.push(scope);
  };

  // Walk every block; for each VariableDeclaration directly inside the block whose kind
  // is `let` or `const`, record the block as the binding scope of each declared name.
  // For the outermost function body, it acts as the function-level scope.
  const walkBlock = (block: Node): void => {
    const scope = { start: block.start, end: block.end };
    const blockBody = (block as unknown as Record<string, unknown>).body;

    if (Array.isArray(blockBody)) {
      for (const stmt of blockBody as ReadonlyArray<Node>) {
        if (is.VariableDeclaration(stmt)) {
          const kind = (stmt as unknown as Record<string, unknown>).kind as string;
          const declarations = (stmt as unknown as Record<string, unknown>).declarations;

          if ((kind === 'let' || kind === 'const') && Array.isArray(declarations)) {
            for (const decl of declarations as ReadonlyArray<Node>) {
              const id = (decl as unknown as Record<string, unknown>).id as Node | undefined;

              if (id) {
                const names: Array<{ name: string }> = [];

                extractDeclaredNames(id, names);

                for (const { name } of names) {
                  recordDeclarationScope(name, scope);
                }
              }
            }
          }
        }
      }
    }
  };

  for (const b of bodies) {
    walkBlock(b);

    const innerBlocks = collectOxcNodes(b, n => is.BlockStatement(n));

    for (const blk of innerBlocks) {
      walkBlock(blk);
    }
  }

  const result: number[] = new Array(defs.length).fill(-1);

  for (let defId = 0; defId < defs.length; defId += 1) {
    const meta = defs[defId];

    if (!meta) {
      continue;
    }

    const scopes = declScopesByName.get(meta.name);
    let innermost = -1;
    let innermostSize = Infinity;

    if (scopes) {
      for (const scope of scopes) {
        if (scope.start <= meta.location && meta.location < scope.end) {
          const size = scope.end - scope.start;

          if (size < innermostSize) {
            innermostSize = size;
            innermost = scope.start;
          }
        }
      }
    }

    // Fall back to the outermost body (e.g. for parameter bindings whose `let/const`
    // declaration doesn't exist in the body).
    if (innermost === -1 && bodies.length > 0) {
      const fallback = bodies[0]!;

      innermost = fallback.start;
    }

    result[defId] = innermost;
  }

  return result;
};

const extractDeclaredNames = (pattern: Node, out: Array<{ name: string }>): void => {
  if (is.Identifier(pattern)) {
    const name = (pattern as unknown as Record<string, unknown>).name;

    if (typeof name === 'string') {
      out.push({ name });
    }

    return;
  }

  if (is.ObjectPattern(pattern)) {
    const properties = (pattern as unknown as Record<string, unknown>).properties;

    if (Array.isArray(properties)) {
      for (const prop of properties as ReadonlyArray<Node>) {
        const p = prop as unknown as Record<string, unknown>;

        if (is.Property(prop)) {
          const value = p.value as Node | undefined;

          if (value) {
            extractDeclaredNames(value, out);
          }
        } else if (is.RestElement(prop)) {
          const arg = p.argument as Node | undefined;

          if (arg) {
            extractDeclaredNames(arg, out);
          }
        }
      }
    }

    return;
  }

  if (is.ArrayPattern(pattern)) {
    const elements = (pattern as unknown as Record<string, unknown>).elements;

    if (Array.isArray(elements)) {
      for (const el of elements as ReadonlyArray<Node | null>) {
        if (el !== null) {
          extractDeclaredNames(el, out);
        }
      }
    }

    return;
  }

  if (is.AssignmentPattern(pattern)) {
    const left = (pattern as unknown as Record<string, unknown>).left as Node | undefined;

    if (left) {
      extractDeclaredNames(left, out);
    }

    return;
  }

  if (is.RestElement(pattern)) {
    const arg = (pattern as unknown as Record<string, unknown>).argument as Node | undefined;

    if (arg) {
      extractDeclaredNames(arg, out);
    }
  }
};

/**
 * Per-(varIndex, scopeStart) flag: does ANY def of this variable at this exact lexical
 * scope reach a use? Used to spare legit `let x; ... x = 1; ... use(x)` declarations
 * without sparing outer declarations that are merely shadowed in a nested block.
 */
const buildVarScopeHasUsedDef = (
  defs: ReadonlyArray<{ varIndex: number } | undefined>,
  usedDefs: { has(n: number): boolean },
  scopeOfDef: ReadonlyArray<number>,
): Set<string> => {
  const set = new Set<string>();

  for (let defId = 0; defId < defs.length; defId += 1) {
    if (!usedDefs.has(defId)) {
      continue;
    }

    const meta = defs[defId];

    if (!meta) {
      continue;
    }

    set.add(`${meta.varIndex}@${scopeOfDef[defId] ?? -1}`);
  }

  return set;
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

  if (Array.isArray(fnParams)) {
    for (const param of fnParams as ReadonlyArray<Node>) {
      if (is.AssignmentPattern(param)) {
        const right = (param as unknown as Record<string, unknown>).right as Node | undefined;

        if (right) {
          parameterDefaults.push(right);
        }
      }
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
  const varHasAnyUsedDef = buildVarHasAnyUsedDef(defs, usedDefs, localIndexByName.size);
  const scopeOfDef = buildScopeMapForFunctionBody(functionBodyNode, defs);
  const varScopeHasUsedDef = buildVarScopeHasUsedDef(defs, usedDefs, scopeOfDef);

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

    if (meta.writeKind === 'declaration' && varHasAnyUsedDef[meta.varIndex] === true) {
      // Spare the declaration only if a USED def of the same variable exists in the
      // SAME lexical scope. Inner-block shadows live in a different scope and must
      // not save the outer declaration from being flagged.
      const myScope = scopeOfDef[defId] ?? -1;

      if (varScopeHasUsedDef.has(`${meta.varIndex}@${myScope}`)) {
        continue;
      }
    }

    if (
      isDefClosureCaptured(
        defId,
        meta.name,
        nestedCtx,
        reachingInByNode as unknown as ReadonlyArray<ReadonlySet<number> | undefined>,
      )
    ) {
      continue;
    }

    if (meta.name.startsWith('_')) {
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
