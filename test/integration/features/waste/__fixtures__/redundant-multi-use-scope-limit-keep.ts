// KEEP (Phase2 scope limit, NOT spec-K): `(x+1)+(x+1)` is observably equivalent
// (pure, W per spec), but multi-use inline duplicates the expression — out of v1
// scope (multi-use = Phase2.1). Locks the single-use boundary as a design choice.
export function f(x: number): number {
  const y = x + 1;
  return y + y;
}
