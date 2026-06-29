// forward-chain depth boundary (BVA): export same-file chain a→b→target.
// export suppresses thin-wrapper (cross-module), so only the forward-chain
// signal remains. At maxForwardDepth=2, a.depth=2 ≤ 2 → NOT reported (empty).
export const target = (x: number): number => x;
export const b = (x: number): number => target(x);
export const a = (x: number): number => b(x);
