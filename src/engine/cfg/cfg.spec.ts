import { describe, it, expect } from 'bun:test';

import { EdgeType } from '../types';
import { IntegerCFG } from './cfg';

interface AdjacencyCase {
  name: string;
  direction: 'forward' | 'backward';
  containerNode: number;
  neighborNode: number;
  emptyNode: number;
}

describe('IntegerCFG', () => {
  it('[HP] starts with 0 nodes', () => {
    const cfg = new IntegerCFG();

    expect(cfg.nodeCount).toBe(0);
  });

  it('[HP] addNode increments nodeCount', () => {
    const cfg = new IntegerCFG();
    const n0 = cfg.addNode();
    const n1 = cfg.addNode();

    expect(n0).toBe(0);
    expect(n1).toBe(1);
    expect(cfg.nodeCount).toBe(2);
  });

  it('[HP] getEdges returns empty before any edges added', () => {
    const cfg = new IntegerCFG();

    cfg.addNode();
    expect(cfg.getEdges().length).toBe(0);
  });

  it('[HP] addEdge stores edge in getEdges result', () => {
    const cfg = new IntegerCFG();
    const a = cfg.addNode();
    const b = cfg.addNode();

    cfg.addEdge(a, b, EdgeType.Normal);

    const edges = cfg.getEdges();

    // edges are [from, to, type] flattened
    expect(edges[0]).toBe(a);
    expect(edges[1]).toBe(b);
    expect(edges[2]).toBe(EdgeType.Normal);
  });

  it('[HP] addEdge stores edge type correctly', () => {
    const cfg = new IntegerCFG();
    const a = cfg.addNode();
    const b = cfg.addNode();

    cfg.addEdge(a, b, EdgeType.True);

    const edges = cfg.getEdges();

    expect(edges[2]).toBe(EdgeType.True);
  });

  // Single edge node0→node1 (addNode returns sequential ids 0,1). Forward adjacency lists
  // successors (adj[0] ∋ 1); backward lists predecessors (adj[1] ∋ 0). `containerNode`
  // holds the neighbor; `emptyNode` has none.
  const adjacencyCases: AdjacencyCase[] = [
    { name: 'forward returns successors', direction: 'forward', containerNode: 0, neighborNode: 1, emptyNode: 1 },
    { name: 'backward returns predecessors', direction: 'backward', containerNode: 1, neighborNode: 0, emptyNode: 0 },
  ];

  it.each(adjacencyCases)('[HP] buildAdjacency $name', ({ direction, containerNode, neighborNode, emptyNode }) => {
    const cfg = new IntegerCFG();

    cfg.addNode();
    cfg.addNode();
    cfg.addEdge(0, 1);

    const adj = cfg.buildAdjacency(direction);

    expect(Array.from(adj[containerNode]!)).toContain(neighborNode);
    expect(Array.from(adj[emptyNode]!)).toHaveLength(0);
  });

  it('[HP] grows internal storage when capacity exceeded', () => {
    const cfg = new IntegerCFG(2); // small initial capacity
    const nodes = Array.from({ length: 5 }, () => cfg.addNode());

    for (let i = 0; i < nodes.length - 1; i++) {
      cfg.addEdge(nodes[i]!, nodes[i + 1]!);
    }

    expect(cfg.getEdges().length).toBe((nodes.length - 1) * 3);
  });

  it('[HP] multiple edges between different nodes', () => {
    const cfg = new IntegerCFG();
    const a = cfg.addNode();
    const b = cfg.addNode();
    const c = cfg.addNode();

    cfg.addEdge(a, b);
    cfg.addEdge(a, c, EdgeType.False);

    const adj = cfg.buildAdjacency('forward');

    expect(Array.from(adj[a]!).sort()).toEqual([b, c].sort());
  });
});
