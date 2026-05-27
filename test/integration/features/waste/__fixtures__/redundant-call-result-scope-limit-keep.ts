// KEEP (Phase2 scope limit, NOT spec-K): `return compute()` is observably
// equivalent (W per spec), but call-RHS single-use is excluded by design to
// avoid flooding common `const r = f(); return r;` idioms. Locks the exclusion.
function compute(): number { return 1; }
export function f(): number {
  const r = compute();
  return r;
}
