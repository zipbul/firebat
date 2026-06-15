import { describe, expect, it } from 'bun:test';

import { IntegerCFG } from '../cfg/cfg';
import { EdgeType } from '../types';
import { computeLiveness } from './liveness';

// Build a CFG with `nodeCount` nodes (ids 0..nodeCount-1) wired by `edges`.
// Hoists the repeated addNode/addEdge construction so each test keeps only its
// distinct topology + use/write data + assertions.
const buildCfg = (nodeCount: number, edges: ReadonlyArray<readonly [number, number, EdgeType]>): IntegerCFG => {
  const cfg = new IntegerCFG();

  for (let i = 0; i < nodeCount; i++) {
    cfg.addNode();
  }

  for (const [from, to, type] of edges) {
    cfg.addEdge(from, to, type);
  }

  return cfg;
};

describe('liveness', () => {
  it('computeLiveness - linear CFG single var used once - maxLiveCount is 1', () => {
    // Arrange
    const cfg = buildCfg(3, [
      [0, 1, EdgeType.Normal],
      [1, 2, EdgeType.Normal],
    ]);
    const useVarIndexesByNode = [
      [], // n0: no uses
      [0], // n1: uses var0
      [], // n2: no uses
    ];
    const writeVarIndexesByNode = [
      [0], // n0: writes var0
      [], // n1: no writes
      [], // n2: no writes
    ];
    // Act
    const result = computeLiveness(cfg, useVarIndexesByNode, writeVarIndexesByNode, 1);

    // Assert
    expect(result.maxLiveCount).toBe(1);
  });

  it('computeLiveness - three vars alive at same point - maxLiveCount is 3', () => {
    // Arrange
    const cfg = buildCfg(2, [[0, 1, EdgeType.Normal]]);
    const useVarIndexesByNode = [
      [], // n0: no uses
      [0, 1, 2], // n1: uses var0, var1, var2
    ];
    const writeVarIndexesByNode = [
      [0, 1, 2], // n0: writes var0, var1, var2
      [], // n1: no writes
    ];
    // Act
    const result = computeLiveness(cfg, useVarIndexesByNode, writeVarIndexesByNode, 3);

    // Assert
    expect(result.maxLiveCount).toBe(3);
  });

  it('computeLiveness - live-through variable from successor - maxLiveCount is 2', () => {
    // Arrange: n0 defines+uses var0, n1 defines+uses var1.
    // var1 is live-through n0 (used in successor n1, not killed in n0).
    // liveIn[n1] = {var1}, liveOut[n0] = {var1}, liveIn[n0] = {var0, var1} → max = 2
    const cfg = buildCfg(2, [[0, 1, EdgeType.Normal]]);
    const useVarIndexesByNode = [
      [0], // n0: uses var0
      [1], // n1: uses var1
    ];
    const writeVarIndexesByNode = [
      [0], // n0: writes var0
      [1], // n1: writes var1
    ];
    // Act
    const result = computeLiveness(cfg, useVarIndexesByNode, writeVarIndexesByNode, 2);

    // Assert
    expect(result.maxLiveCount).toBe(2);
  });

  it('computeLiveness - no variables (varCount=0) - maxLiveCount is 0', () => {
    // Arrange
    const cfg = buildCfg(2, []);
    const useVarIndexesByNode: number[][] = [[], []];
    const writeVarIndexesByNode: number[][] = [[], []];
    // Act
    const result = computeLiveness(cfg, useVarIndexesByNode, writeVarIndexesByNode, 0);

    // Assert
    expect(result.maxLiveCount).toBe(0);
    expect(result.liveInByNode).toHaveLength(0);
  });

  it('computeLiveness - branching CFG - max across all branches', () => {
    // Arrange: n0 writes var0+var1, n1 uses var0, n2 uses var1
    // liveIn[n1]={var0}, liveIn[n2]={var1}, liveOut[n0]={var0,var1}
    // liveIn[n0] = USE[n0] union (liveOut[n0] - DEF[n0]) = {} union {} = {}
    // maxLiveCount = 1 (max of liveIn sizes: 0, 1, 1)
    const cfg = buildCfg(3, [
      [0, 1, EdgeType.True],
      [0, 2, EdgeType.False],
    ]);
    const useVarIndexesByNode = [
      [], // n0: no uses
      [0], // n1: uses var0
      [1], // n2: uses var1
    ];
    const writeVarIndexesByNode = [
      [0, 1], // n0: writes var0 and var1
      [], // n1: no writes
      [], // n2: no writes
    ];
    // Act
    const result = computeLiveness(cfg, useVarIndexesByNode, writeVarIndexesByNode, 2);

    // Assert
    expect(result.maxLiveCount).toBe(1);
  });

  it('computeLiveness - loop back-edge - fixed-point converges', () => {
    // Arrange: n0 writes var0, n1 uses+writes var0 (loop), n1->n1 back-edge, n1->n2 exit
    const cfg = buildCfg(3, [
      [0, 1, EdgeType.Normal],
      [1, 1, EdgeType.Normal],
      [1, 2, EdgeType.Normal],
    ]);
    const useVarIndexesByNode = [
      [], // n0: no uses
      [0], // n1: uses var0
      [], // n2: no uses
    ];
    const writeVarIndexesByNode = [
      [0], // n0: initializes var0
      [0], // n1: updates var0 (loop variable)
      [], // n2: no writes
    ];
    // Act
    const result = computeLiveness(cfg, useVarIndexesByNode, writeVarIndexesByNode, 1);

    // Assert — fixed-point must converge
    expect(result.maxLiveCount).toBe(1);
    expect(result.liveInByNode).toHaveLength(3);
  });

  it('computeLiveness - empty CFG (nodeCount=0) - returns empty result', () => {
    // Arrange
    const cfg = buildCfg(0, []);
    // Act
    const result = computeLiveness(cfg, [], [], 1);

    // Assert
    expect(result.maxLiveCount).toBe(0);
    expect(result.maxLiveNodeId).toBe(0);
    expect(result.liveInByNode).toHaveLength(0);
  });

  it('computeLiveness - diamond merge CFG - both branch live vars merge at join point', () => {
    // Arrange: n0 defines var0+var1, branches to n1(uses var0) and n2(uses var1), both merge at n3(uses both).
    // Backward dataflow:
    //   liveIn[n3] = {var0, var1}  (both used)
    //   liveIn[n1] = {var0} ∪ ({var0,var1} - {}) = {var0, var1}
    //   liveIn[n2] = {var1} ∪ ({var0,var1} - {}) = {var0, var1}
    //   liveOut[n0] = liveIn[n1] ∪ liveIn[n2] = {var0, var1}
    //   liveIn[n0] = {} ∪ ({var0,var1} - {var0,var1}) = {}  (n0 defines both → kills them)
    //   maxLiveCount = 2 (at n1, n2, or n3)
    const cfg = buildCfg(4, [
      [0, 1, EdgeType.True],
      [0, 2, EdgeType.False],
      [1, 3, EdgeType.Normal],
      [2, 3, EdgeType.Normal],
    ]);
    const useVarIndexesByNode = [
      [], // n0: no uses
      [0], // n1: uses var0 (true branch)
      [1], // n2: uses var1 (false branch)
      [0, 1], // n3: uses both var0 and var1 at merge
    ];
    const writeVarIndexesByNode = [
      [0, 1], // n0: writes var0, var1
      [], // n1: no writes
      [], // n2: no writes
      [], // n3: no writes
    ];
    // Act
    const result = computeLiveness(cfg, useVarIndexesByNode, writeVarIndexesByNode, 2);

    // Assert — join point n3 and both branches have 2 live vars; entry n0 has 0 (defs kill both)
    expect(result.maxLiveCount).toBe(2);
    expect(result.liveInByNode).toHaveLength(4);
    expect(result.liveInByNode[0]?.size()).toBe(0); // n0 defines var0+var1 → they are killed in liveIn
    expect(result.liveInByNode[3]?.size()).toBe(2); // n3 (merge) needs both vars
  });

  it('computeLiveness - sequential death chain - live count decreases monotonically', () => {
    // Arrange: n0 defs var0,var1,var2 → n1 uses var0 → n2 uses var1 → n3 uses var2
    // After each use the var is no longer needed downstream, so it becomes dead.
    // liveIn[n3] = {var2}, liveIn[n2] = {var1,var2}, liveIn[n1] = {var0,var1,var2}, liveIn[n0] = {}
    const cfg = buildCfg(4, [
      [0, 1, EdgeType.Normal],
      [1, 2, EdgeType.Normal],
      [2, 3, EdgeType.Normal],
    ]);
    const useVarIndexesByNode = [
      [], // n0: no uses
      [0], // n1: uses var0 only (var0 dies here)
      [1], // n2: uses var1 only (var1 dies here)
      [2], // n3: uses var2 only (var2 dies here)
    ];
    const writeVarIndexesByNode = [
      [0, 1, 2], // n0: defines all three
      [], // n1: no writes
      [], // n2: no writes
      [], // n3: no writes
    ];
    // Act
    const result = computeLiveness(cfg, useVarIndexesByNode, writeVarIndexesByNode, 3);

    // Assert — live counts: n0=0, n1=3, n2=2, n3=1  → maxLiveCount = 3 at n1
    expect(result.maxLiveCount).toBe(3);
    expect(result.liveInByNode[0]?.size()).toBe(0);
    expect(result.liveInByNode[1]?.size()).toBe(3);
    expect(result.liveInByNode[2]?.size()).toBe(2);
    expect(result.liveInByNode[3]?.size()).toBe(1);
  });
});
