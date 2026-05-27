// KEEP (Phase2): fresh allocation captured by a closure. The binding fixes one
// object identity; inlining `() => ({})` returns a new object each call.
export function f(): () => object {
  const o = {};
  return () => o;
}
