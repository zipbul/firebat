// KEEP-for-redundant (Phase2): the single use is unreachable (`return n` after a
// prior return), so the binding is already a dead-store, not a redundant binding.
// Only the dead-store should be reported — no double-emit as redundant-binding.
export function f(a: { x: number }): number {
  const n = a.x;
  return 1;
  return n;
}
