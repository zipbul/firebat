import type { IntegerCFG } from '../cfg/cfg';
import type { BitSet } from '../types';

import { createBitSet, equalsBitSet, subtractBitSet, unionBitSet } from './dataflow';

interface LivenessResult {
  readonly liveInByNode: ReadonlyArray<BitSet>;
  readonly maxLiveCount: number;
  readonly maxLiveNodeId: number;
}

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
  const useSets: BitSet[] = [];
  const defSets: BitSet[] = [];

  for (let n = 0; n < nodeCount; n++) {
    const u = createBitSet();
    const uses = useVarIndexesByNode[n];

    if (uses) {
      for (const vi of uses) {
        u.add(vi);
      }
    }

    useSets.push(u);

    const d = createBitSet();
    const writes = writeVarIndexesByNode[n];

    if (writes) {
      for (const vi of writes) {
        d.add(vi);
      }
    }

    defSets.push(d);
  }

  const liveIn: BitSet[] = Array.from({ length: nodeCount }, () => createBitSet());
  const liveOut: BitSet[] = Array.from({ length: nodeCount }, () => createBitSet());
  let changed = true;

  while (changed) {
    changed = false;

    for (let n = nodeCount - 1; n >= 0; n--) {
      let newOut = createBitSet();
      const successors = succ[n];

      if (successors) {
        for (const s of successors) {
          const sIn = liveIn[s];

          if (sIn) {
            newOut = unionBitSet(newOut, sIn);
          }
        }
      }

      const useSet = useSets[n];
      const defSet = defSets[n];
      const prevOut = liveOut[n];
      const prevIn = liveIn[n];

      if (!useSet || !defSet || !prevOut || !prevIn) {
        continue;
      }

      const newIn = unionBitSet(useSet, subtractBitSet(newOut, defSet));

      if (!equalsBitSet(newOut, prevOut)) {
        liveOut[n] = newOut;
        changed = true;
      }

      if (!equalsBitSet(newIn, prevIn)) {
        liveIn[n] = newIn;
        changed = true;
      }
    }
  }

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

  return { liveInByNode: liveIn, maxLiveCount, maxLiveNodeId };
};
