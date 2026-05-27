// DEAD (Phase2): captured by a closure, but RHS is pure and its source (param x)
// is never reassigned → per-call re-evaluation yields the same value, no effect.
export function f(x: number): () => number {
  const y = x + 1;
  return () => y;
}
