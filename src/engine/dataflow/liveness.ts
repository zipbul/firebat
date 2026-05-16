import type { IntegerCFG } from '../cfg';
import type { BitSet } from '../types';

import { createBitSet, equalsBitSet, subtractBitSet, unionBitSet } from './dataflow';

interface LivenessResult {
  readonly liveInByNode: ReadonlyArray<BitSet>;
  readonly maxLiveCount: number;
  readonly maxLiveNodeId: number;
}

const buildBitSetFromIndexes = (indexes: ReadonlyArray<number> | undefined): BitSet => {
  const set = createBitSet();

  if (indexes) {
    for (const vi of indexes) {
      set.add(vi);
    }
  }

  return set;
};

const buildUsageAndDefSets = (
  nodeCount: number,
  useVarIndexesByNode: ReadonlyArray<ReadonlyArray<number>>,
  writeVarIndexesByNode: ReadonlyArray<ReadonlyArray<number>>,
): { useSets: BitSet[]; defSets: BitSet[] } => {
  const useSets: BitSet[] = [];
  const defSets: BitSet[] = [];

  for (let n = 0; n < nodeCount; n++) {
    useSets.push(buildBitSetFromIndexes(useVarIndexesByNode[n]));
    defSets.push(buildBitSetFromIndexes(writeVarIndexesByNode[n]));
  }

  return { useSets, defSets };
};

const computeNewOutForNode = (n: number, succ: Int32Array[], liveIn: BitSet[]): BitSet => {
  let newOut = createBitSet();
  const successors = succ[n];

  if (!successors) {
    return newOut;
  }

  for (const s of successors) {
    const sIn = liveIn[s];

    if (sIn) {
      newOut = unionBitSet(newOut, sIn);
    }
  }

  return newOut;
};

interface NodeLivenessEntry {
  readonly newOut: BitSet;
  readonly newIn: BitSet;
}

const computeNodeLivenessEntry = (
  n: number,
  succ: Int32Array[],
  liveIn: BitSet[],
  useSet: BitSet,
  defSet: BitSet,
): NodeLivenessEntry => {
  const newOut = computeNewOutForNode(n, succ, liveIn);
  const newIn = unionBitSet(useSet, subtractBitSet(newOut, defSet));

  return { newOut, newIn };
};

const processLivenessNode = (
  n: number,
  succ: Int32Array[],
  useSets: BitSet[],
  defSets: BitSet[],
  liveIn: BitSet[],
  liveOut: BitSet[],
): boolean => {
  const useSet = useSets[n];
  const defSet = defSets[n];
  const prevOut = liveOut[n];
  const prevIn = liveIn[n];

  if (!useSet || !defSet || !prevOut || !prevIn) {
    return false;
  }

  const { newOut, newIn } = computeNodeLivenessEntry(n, succ, liveIn, useSet, defSet);
  let changed = false;

  if (!equalsBitSet(newOut, prevOut)) {
    liveOut[n] = newOut;
    changed = true;
  }

  if (!equalsBitSet(newIn, prevIn)) {
    liveIn[n] = newIn;
    changed = true;
  }

  return changed;
};

const runLivenessPass = (
  nodeCount: number,
  succ: Int32Array[],
  useSets: BitSet[],
  defSets: BitSet[],
  liveIn: BitSet[],
  liveOut: BitSet[],
): boolean => {
  let changed = false;

  for (let n = nodeCount - 1; n >= 0; n--) {
    if (processLivenessNode(n, succ, useSets, defSets, liveIn, liveOut)) {
      changed = true;
    }
  }

  return changed;
};

const iterateLiveness = (
  nodeCount: number,
  succ: Int32Array[],
  useSets: BitSet[],
  defSets: BitSet[],
): { liveIn: BitSet[]; liveOut: BitSet[] } => {
  const liveIn: BitSet[] = Array.from({ length: nodeCount }, createBitSet);
  const liveOut: BitSet[] = Array.from({ length: nodeCount }, createBitSet);

  while (runLivenessPass(nodeCount, succ, useSets, defSets, liveIn, liveOut)) {
    // repeat until no changes
  }

  return { liveIn, liveOut };
};

const findMaxLiveNode = (liveIn: BitSet[], nodeCount: number): { maxLiveCount: number; maxLiveNodeId: number } => {
  let maxLiveCount = 0;
  let maxLiveNodeId = 0;

  for (let n = 0; n < nodeCount; n++) {
    const nodeIn = liveIn[n];

    if (!nodeIn) {
      continue;
    }

    const count = nodeIn.size();

    if (count <= maxLiveCount) {
      continue;
    }

    maxLiveCount = count;
    maxLiveNodeId = n;
  }

  return { maxLiveCount, maxLiveNodeId };
};

export const computeLiveness = (
  cfg: IntegerCFG,
  useVarIndexesByNode: ReadonlyArray<ReadonlyArray<number>>,
  writeVarIndexesByNode: ReadonlyArray<ReadonlyArray<number>>,
  varCount: number,
): LivenessResult => {
  const nodeCount = cfg.nodeCount;

  if (nodeCount === 0 || varCount === 0) {
    return { liveInByNode: [], maxLiveCount: 0, maxLiveNodeId: 0 };
  }

  const succ = cfg.buildAdjacency('forward');
  const { useSets, defSets } = buildUsageAndDefSets(nodeCount, useVarIndexesByNode, writeVarIndexesByNode);
  const { liveIn } = iterateLiveness(nodeCount, succ, useSets, defSets);
  const { maxLiveCount, maxLiveNodeId } = findMaxLiveNode(liveIn, nodeCount);

  return { liveInByNode: liveIn, maxLiveCount, maxLiveNodeId };
};
