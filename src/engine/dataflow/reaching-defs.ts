import type { Function as OxcFunction, Node } from 'oxc-parser';

import type { BitSet, DefMeta, FunctionBodyAnalysis } from '../types';

import { OxcCFGBuilder } from '../cfg';
import { createBitSet, equalsBitSet, intersectBitSet, subtractBitSet, unionBitSet } from './dataflow';
import { collectVariables } from './variable-collector';

export interface BindingName {
  readonly name: string;
  readonly location: number;
}

/**
 * Walk a binding-pattern subtree and record each declared identifier.
 * `node` is one of: Identifier (binding form), ObjectPattern, ArrayPattern,
 * AssignmentPattern, or RestElement — all narrowed by oxc-parser's union.
 */
export const extractBindingNames = (node: Node, out: BindingName[]): void => {
  if (node.type === 'Identifier') {
    out.push({ name: node.name, location: node.start });

    return;
  }

  if (node.type === 'ObjectPattern') {
    for (const prop of node.properties) {
      if (prop.type === 'Property') {
        extractBindingNames(prop.value, out);
      } else {
        extractBindingNames(prop.argument, out);
      }
    }

    return;
  }

  if (node.type === 'ArrayPattern') {
    for (const element of node.elements) {
      if (element === null) {
        continue;
      }

      extractBindingNames(element, out);
    }

    return;
  }

  if (node.type === 'AssignmentPattern') {
    extractBindingNames(node.left, out);

    return;
  }

  if (node.type === 'RestElement') {
    extractBindingNames(node.argument, out);
  }
};

export const collectParameterBindings = (functionNode: Node): ReadonlyArray<BindingName> => {
  const bindings: BindingName[] = [];
  const fn = functionNode as OxcFunction;

  for (const param of fn.params) {
    extractBindingNames(param, bindings);
  }

  return bindings;
};

export const collectLocalVarIndexes = (functionNode: Node): Map<string, number> => {
  const names = new Set<string>();
  const parameterBindings = collectParameterBindings(functionNode);

  for (const binding of parameterBindings) {
    names.add(binding.name);
  }

  const fn2 = functionNode as OxcFunction;
  const bodyNode = fn2.body as Node | null;
  const bodyUsages = bodyNode !== null ? collectVariables(bodyNode, { includeNestedFunctions: false }) : [];

  for (const usage of bodyUsages) {
    if (usage.isWrite && usage.writeKind === 'declaration') {
      names.add(usage.name);
    }
  }

  const out = new Map<string, number>();
  let index = 0;

  for (const name of names) {
    out.set(name, index);

    index += 1;
  }

  return out;
};

const unionAll = (sets: readonly BitSet[], empty: BitSet): BitSet => {
  let current = empty;

  for (const set of sets) {
    current = unionBitSet(current, set);
  }

  return current;
};

interface DefUseState {
  defsByVarIndex: number[][];
  defMetaById: DefMeta[];
  genDefIdsByNode: number[][];
  useVarIndexesByNode: number[][];
  writeVarIndexesByNode: number[][];
  defNodeIdByDefId: number[];
  nodePayloads: ReturnType<typeof OxcCFGBuilder.build>['nodePayloads'];
  /** Defs that were demoted from gen because a later write to the same var
   *  happens at the same CFG payload (e.g. sequence expressions). */
  intraNodeOverwrittenDefIds: ReadonlyArray<number>;
}

type DefUseStateMut = Pick<
  DefUseState,
  'defMetaById' | 'defsByVarIndex' | 'genDefIdsByNode' | 'useVarIndexesByNode' | 'writeVarIndexesByNode' | 'defNodeIdByDefId'
>;

const registerWriteUsage = (
  nodeId: number,
  varIndex: number,
  usage: { name: string; location: number; writeKind?: DefMeta['writeKind'] },
  writeIndexes: Set<number>,
  state: DefUseStateMut,
): void => {
  writeIndexes.add(varIndex);

  const defId = state.defMetaById.length;
  const meta: DefMeta = usage.writeKind
    ? { name: usage.name, varIndex, location: usage.location, writeKind: usage.writeKind }
    : { name: usage.name, varIndex, location: usage.location };

  state.defMetaById.push(meta);

  state.defNodeIdByDefId[defId] = nodeId;

  state.defsByVarIndex[varIndex]?.push(defId);
  state.genDefIdsByNode[nodeId]?.push(defId);
};

const processNodeUsages = (
  nodeId: number,
  payload: ReturnType<typeof OxcCFGBuilder.build>['nodePayloads'][number],
  localIndexByName: Map<string, number>,
  state: DefUseStateMut,
): void => {
  const usages = Array.isArray(payload)
    ? (payload as Node[]).flatMap(p => collectVariables(p, { includeNestedFunctions: false }))
    : collectVariables(payload as Node, { includeNestedFunctions: false });
  const useIndexes = new Set<number>();
  const writeIndexes = new Set<number>();

  for (const usage of usages) {
    const varIndex = localIndexByName.get(usage.name);

    if (typeof varIndex !== 'number') {
      continue;
    }

    if (usage.isRead) {
      useIndexes.add(varIndex);
    }

    if (usage.isWrite) {
      registerWriteUsage(nodeId, varIndex, usage, writeIndexes, state);
    }
  }

  state.useVarIndexesByNode[nodeId] = [...useIndexes];
  state.writeVarIndexesByNode[nodeId] = [...writeIndexes];
};

const buildDefUseState = (
  built: ReturnType<typeof OxcCFGBuilder.build>,
  localIndexByName: Map<string, number>,
  parameterBindings: ReadonlyArray<BindingName>,
): DefUseState => {
  const nodeCount = built.cfg.nodeCount;
  const nodePayloads = built.nodePayloads;
  const entryId = built.entryId;
  const defsByVarIndex: number[][] = Array.from({ length: localIndexByName.size }, () => []);
  const defMetaById: DefMeta[] = [];
  const genDefIdsByNode: number[][] = Array.from({ length: nodeCount }, () => []);
  const useVarIndexesByNode: number[][] = Array.from({ length: nodeCount }, () => []);
  const writeVarIndexesByNode: number[][] = Array.from({ length: nodeCount }, () => []);
  const defNodeIdByDefId: number[] = [];
  const state = { defsByVarIndex, defMetaById, genDefIdsByNode, useVarIndexesByNode, writeVarIndexesByNode, defNodeIdByDefId };

  // Seed parameter bindings as definitions at CFG entry so unused params can be detected.
  for (const binding of parameterBindings) {
    const varIndex = localIndexByName.get(binding.name);

    if (typeof varIndex !== 'number') {
      continue;
    }

    const defId = defMetaById.length;

    defMetaById.push({ name: binding.name, varIndex, location: binding.location, writeKind: 'declaration' });
    defsByVarIndex[varIndex]?.push(defId);
    genDefIdsByNode[entryId]?.push(defId);

    defNodeIdByDefId[defId] = entryId;
  }

  for (let nodeId = 0; nodeId < nodeCount; nodeId += 1) {
    const payload = nodePayloads[nodeId];

    if (!payload) {
      continue;
    }

    processNodeUsages(nodeId, payload, localIndexByName, state);
  }

  // Resolve intra-node sequential writes to the same variable. When a single CFG
  // payload contains multiple writes to the same var (e.g. `(x=1, x=2)` in a sequence
  // expression), only the last write should reach forward; earlier ones are dead at
  // the node. Filter gen to keep only the latest def per var and return the displaced
  // defIds for caller to mark as overwritten.
  const intraNodeOverwritten: number[] = [];

  for (let nodeId = 0; nodeId < nodeCount; nodeId += 1) {
    const genIds = state.genDefIdsByNode[nodeId];

    if (!genIds || genIds.length <= 1) {
      continue;
    }

    const lastByVar = new Map<number, number>();

    for (const defId of genIds) {
      const meta = state.defMetaById[defId];

      if (!meta) {
        continue;
      }

      const existing = lastByVar.get(meta.varIndex);

      if (existing === undefined) {
        lastByVar.set(meta.varIndex, defId);

        continue;
      }

      const existingMeta = state.defMetaById[existing]!;

      if (meta.location > existingMeta.location) {
        intraNodeOverwritten.push(existing);
        lastByVar.set(meta.varIndex, defId);
      } else {
        intraNodeOverwritten.push(defId);
      }
    }

    if (intraNodeOverwritten.length === 0) {
      continue;
    }

    // Replace gen with the latest def per var. Earlier defs are removed from gen so
    // the standard `kill = defsOfVar - gen` formula kills them at this node.
    state.genDefIdsByNode[nodeId] = [...lastByVar.values()];
  }

  return { ...state, nodePayloads, intraNodeOverwrittenDefIds: intraNodeOverwritten };
};

interface GenKillSets {
  genByNode: BitSet[];
  killByNode: BitSet[];
  defsOfVar: BitSet[];
}

const buildKillSetForNode = (writtenVars: ReadonlyArray<number>, defsOfVar: BitSet[], genSet: BitSet): BitSet => {
  let kill = createBitSet();

  for (const varIndex of writtenVars) {
    const defs = defsOfVar[varIndex];

    if (defs) {
      kill = unionBitSet(kill, defs);
    }
  }

  return subtractBitSet(kill, genSet);
};

const buildGenKillSets = (state: DefUseState, nodeCount: number, varCount: number): GenKillSets => {
  const { defsByVarIndex, genDefIdsByNode, writeVarIndexesByNode } = state;
  const genByNode: BitSet[] = Array.from({ length: nodeCount }, createBitSet);
  const killByNode: BitSet[] = Array.from({ length: nodeCount }, createBitSet);
  const defsOfVar: BitSet[] = Array.from({ length: varCount }, createBitSet);

  for (let varIndex = 0; varIndex < defsByVarIndex.length; varIndex += 1) {
    const ids = defsByVarIndex[varIndex] ?? [];

    for (const defId of ids) {
      defsOfVar[varIndex]?.add(defId);
    }
  }

  for (let nodeId = 0; nodeId < nodeCount; nodeId += 1) {
    const genIds = genDefIdsByNode[nodeId] ?? [];

    for (const defId of genIds) {
      genByNode[nodeId]?.add(defId);
    }

    const writtenVars = writeVarIndexesByNode[nodeId] ?? [];

    killByNode[nodeId] = buildKillSetForNode(writtenVars, defsOfVar, genByNode[nodeId] ?? createBitSet());
  }

  return { genByNode, killByNode, defsOfVar };
};

const computeReachingDefsForNode = (
  nodeId: number,
  pred: Int32Array[],
  outByNode: BitSet[],
  genByNode: BitSet[],
  killByNode: BitSet[],
  empty: BitSet,
): { nextIn: BitSet; nextOut: BitSet } => {
  const predIds = pred[nodeId] ?? new Int32Array();
  const predOutSets: BitSet[] = [];

  for (const p of predIds) {
    const out = outByNode[p];

    if (out) {
      predOutSets.push(out);
    }
  }

  const nextIn = unionAll(predOutSets, empty.clone());
  const nextOut = unionBitSet(genByNode[nodeId] ?? createBitSet(), subtractBitSet(nextIn, killByNode[nodeId] ?? createBitSet()));

  return { nextIn, nextOut };
};

const runReachingDefsPass = (
  nodeCount: number,
  pred: Int32Array[],
  genByNode: BitSet[],
  killByNode: BitSet[],
  inByNode: BitSet[],
  outByNode: BitSet[],
  empty: BitSet,
): boolean => {
  let changed = false;

  for (let nodeId = 0; nodeId < nodeCount; nodeId += 1) {
    const { nextIn, nextOut } = computeReachingDefsForNode(nodeId, pred, outByNode, genByNode, killByNode, empty);

    if (!equalsBitSet(nextIn, inByNode[nodeId] ?? createBitSet())) {
      inByNode[nodeId] = nextIn;
      changed = true;
    }

    if (!equalsBitSet(nextOut, outByNode[nodeId] ?? createBitSet())) {
      outByNode[nodeId] = nextOut;
      changed = true;
    }
  }

  return changed;
};

const computeReachingDefs = (
  pred: Int32Array[],
  nodeCount: number,
  genByNode: BitSet[],
  killByNode: BitSet[],
): { inByNode: BitSet[]; outByNode: BitSet[] } => {
  const empty = createBitSet();
  const inByNode: BitSet[] = Array.from({ length: nodeCount }, createBitSet);
  const outByNode: BitSet[] = Array.from({ length: nodeCount }, createBitSet);

  while (runReachingDefsPass(nodeCount, pred, genByNode, killByNode, inByNode, outByNode, empty)) {
    // repeat until no changes
  }

  return { inByNode, outByNode };
};

const collectUsedDefsForNode = (
  uses: ReadonlyArray<number>,
  reachingIn: BitSet,
  defsOfVar: BitSet[],
  usedDefs: BitSet,
): BitSet => {
  let result = usedDefs;

  for (const varIndex of uses) {
    const defs = defsOfVar[varIndex];

    if (defs) {
      result = unionBitSet(result, intersectBitSet(reachingIn, defs));
    }
  }

  return result;
};

const markOverwrittenDefsForNode = (
  writtenVars: ReadonlyArray<number>,
  reachingIn: BitSet,
  defsOfVar: BitSet[],
  genSet: BitSet,
  overwrittenDefIds: boolean[],
): void => {
  for (const varIndex of writtenVars) {
    const defs = defsOfVar[varIndex];

    if (!defs) {
      continue;
    }

    const killedHere = subtractBitSet(intersectBitSet(reachingIn, defs), genSet);

    for (const defId of killedHere.array()) {
      overwrittenDefIds[defId] = true;
    }
  }
};

const collectUsedAndOverwrittenDefs = (
  state: DefUseState,
  genByNode: BitSet[],
  inByNode: BitSet[],
  defsOfVar: BitSet[],
  defCount: number,
  nodeCount: number,
): { usedDefs: BitSet; overwrittenDefIds: boolean[] } => {
  const { useVarIndexesByNode, writeVarIndexesByNode } = state;
  let usedDefs = createBitSet();

  for (let nodeId = 0; nodeId < nodeCount; nodeId += 1) {
    const uses = useVarIndexesByNode[nodeId] ?? [];
    const reachingIn = inByNode[nodeId] ?? createBitSet();

    usedDefs = collectUsedDefsForNode(uses, reachingIn, defsOfVar, usedDefs);
  }

  const overwrittenDefIds: boolean[] = Array.from({ length: defCount }, () => false);

  for (let nodeId = 0; nodeId < nodeCount; nodeId += 1) {
    const writtenVars = writeVarIndexesByNode[nodeId] ?? [];
    const reachingIn = inByNode[nodeId] ?? createBitSet();

    markOverwrittenDefsForNode(writtenVars, reachingIn, defsOfVar, genByNode[nodeId] ?? createBitSet(), overwrittenDefIds);
  }

  return { usedDefs, overwrittenDefIds };
};

export const analyzeFunctionBody = (
  bodyNode: Node | ReadonlyArray<Node> | undefined,
  localIndexByName: Map<string, number>,
  parameterBindings: ReadonlyArray<BindingName>,
  parameterDefaults: ReadonlyArray<Node> = [],
): FunctionBodyAnalysis => {
  const built = OxcCFGBuilder.build(bodyNode);
  const nodeCount = built.cfg.nodeCount;
  const state = buildDefUseState(built, localIndexByName, parameterBindings);
  const { genByNode, killByNode, defsOfVar } = buildGenKillSets(state, nodeCount, localIndexByName.size);
  const pred = built.cfg.buildAdjacency('backward');
  const { inByNode } = computeReachingDefs(pred, nodeCount, genByNode, killByNode);
  const defCount = state.defMetaById.length;
  let { usedDefs, overwrittenDefIds } = collectUsedAndOverwrittenDefs(
    state,
    genByNode,
    inByNode,
    defsOfVar,
    defCount,
    nodeCount,
  );

  // Defs displaced by a same-node later write are dead at the node — record them as
  // overwritten so the waste detector emits `dead-store-overwrite` rather than nothing.
  for (const defId of state.intraNodeOverwrittenDefIds) {
    overwrittenDefIds[defId] = true;
  }

  // Identifier reads inside parameter default expressions (`function f(a=1, b=a)`)
  // belong to the function's call-time evaluation, not its body, so the CFG over the
  // body doesn't capture them. Mark the matching parameter defs as used directly.
  if (parameterDefaults.length > 0) {
    const defaultReadNames = new Set<string>();

    for (const defaultExpr of parameterDefaults) {
      for (const u of collectVariables(defaultExpr, { includeNestedFunctions: false })) {
        if (u.isRead) {
          defaultReadNames.add(u.name);
        }
      }
    }

    if (defaultReadNames.size > 0) {
      for (let defId = 0; defId < state.defMetaById.length; defId += 1) {
        const meta = state.defMetaById[defId];

        if (meta && meta.writeKind === 'declaration' && defaultReadNames.has(meta.name)) {
          usedDefs.add(defId);
        }
      }
    }
  }

  return {
    usedDefs,
    overwrittenDefIds,
    defs: state.defMetaById,
    reachingInByNode: inByNode,
    defNodeIdByDefId: state.defNodeIdByDefId,
    nodePayloads: built.nodePayloads,
    cfg: built.cfg,
    exitId: built.exitId,
    useVarIndexesByNode: state.useVarIndexesByNode,
    writeVarIndexesByNode: state.writeVarIndexesByNode,
    defsOfVar,
  };
};

export const __testing__ = { extractBindingNames };
