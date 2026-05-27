// DEAD (Phase2): single-use pure arith binding. `y` is read exactly once;
// inlining `x + 1` preserves behavior + types.
export function f(x: number): number {
  const y = x + 1;
  return y * 2;
}
