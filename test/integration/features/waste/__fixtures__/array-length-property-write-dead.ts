// DEAD (case 7): a fresh array whose only use is a length property write and
// that does not escape. Setting `length` only deletes own-indices — local-only
// mutation by CLAUDE.md "관찰 가능한 동작" boundary (no escape, no side-effect).
// Consistent with `arr[100] = 1` which is also case 7 dead on a non-escaping
// fresh array.

export function f(): void {
  const c: number[] = [];

  c.length = 0;
}
