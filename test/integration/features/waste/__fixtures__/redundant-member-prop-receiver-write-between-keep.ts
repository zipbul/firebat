// KEEP (Phase2): `obj.p` is read, then `obj.p` is written before the use. This is
// a snapshot-before-mutation (CLAUDE.md K). Inlining would read the new value.
export function f(obj: { p: number }): number {
  const t = obj.p;
  obj.p = 9;
  return t;
}
