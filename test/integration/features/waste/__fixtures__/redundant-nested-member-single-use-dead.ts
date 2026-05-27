// DEAD (Phase2): nested member `a.b.c`, single use, nothing between. Single
// evaluation at the same point → W (receiver-shape is irrelevant for single use).
export function f(a: { b: { c: number } }): number {
  const v = a.b.c;
  return v + 1;
}
