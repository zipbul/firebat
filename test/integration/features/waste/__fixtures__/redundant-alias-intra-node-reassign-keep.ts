// KEEP (Phase2, zustand:59 pattern): the source `current` is reassigned between
// the alias declaration and its use. Inlining `previous`→`current` would read the
// new value. gate6 (no reassignment of source between decl and use) blocks this.
export function f(next: number): number {
  let current = 1;
  const previous = current;
  current = next;
  return current + previous;
}
