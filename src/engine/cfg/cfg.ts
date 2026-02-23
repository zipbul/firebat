import { EdgeType, type NodeId } from './cfg-types';

const INITIAL_CAPACITY = 1024;

/**
 * Ad-hoc Integer Graph (Zero Dependency, GC-friendly)
 * Stores graph topology in flat TypedArrays.
 */
class IntegerCFG {
  // Edge storage: [source, target, type] flattened
  // We use a simple flat push approach.
  public nodeCount: number = 0;

  // Basic Block / Node info could be stored here if needed
  private edges: Int32Array;
  private edgeCursor: number = 0;

  constructor(capacity: number = INITIAL_CAPACITY) {
    this.edges = new Int32Array(capacity * 3);
  }

  public addNode(): NodeId {
    return this.nodeCount++;
  }

  public addEdge(from: NodeId, to: NodeId, type: EdgeType = EdgeType.Normal): void {
    if (this.edgeCursor * 3 >= this.edges.length) {
      this.grow();
    }

    const offset = this.edgeCursor * 3;

    this.edges[offset] = from;
    this.edges[offset + 1] = to;
    this.edges[offset + 2] = type;

    this.edgeCursor++;
  }

  // Iterators or accessors for analysis
  public getEdges(): Int32Array {
    return this.edges.subarray(0, this.edgeCursor * 3);
  }

  // Build adjacency list specifically for backward analysis (pred) or forward (succ)
  // Re-materialize only when needed for analysis phase
  public buildAdjacency(direction: 'forward' | 'backward'): Int32Array[] {
    const adj: number[][] = Array.from({ length: this.nodeCount }, () => []);
    const count = this.edgeCursor;

    for (let i = 0; i < count; i++) {
      const offset = i * 3;
      const from = this.edges[offset];
      const to = this.edges[offset + 1];

      if (from === undefined || to === undefined) {
        continue;
      }

      if (from < 0 || from >= this.nodeCount) {
        continue;
      }

      if (to < 0 || to >= this.nodeCount) {
        continue;
      }

      if (direction === 'forward') {
        const bucket = adj[from];

        if (bucket !== undefined) {
          bucket.push(to);
        }
      } else {
        const bucket = adj[to];

        if (bucket !== undefined) {
          bucket.push(from);
        }
      }
    }

    // Convert to TypedArrays for cache locality if needed, or return number[][]
    // number[][] is fine for iteration, but the prompt stressed "Ad-hoc Integer".
    // Let's return Int32Array[] for "Hyper-Strict".
    return adj.map(arr => new Int32Array(arr));
  }

  private grow(): void {
    const newEdges = new Int32Array(this.edges.length * 2);

    newEdges.set(this.edges);

    this.edges = newEdges;
  }
}

export { IntegerCFG };
