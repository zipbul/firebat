// KEEP (Phase2): a member read captured by a closure that runs after the receiver
// is mutated. Inlining `() => obj.n` would read the new value, not the snapshot.
export function f(): () => number {
  const obj = { n: 1 };
  const y = obj.n;
  const cb = (): number => y;
  obj.n = 999;
  return cb;
}
