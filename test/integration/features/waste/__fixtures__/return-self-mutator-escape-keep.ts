// KEEP boundary: sort() returns the receiver array, and that return value is
// consumed (.join → return), so the array's content escapes. Return-self
// mutators (sort/reverse/fill/copyWithin/set/add) whose result is consumed are
// classified as 'escape', not local mutation — so case 6/7 does not fire.
export function f(items: ReadonlyArray<string>): string {
  const parts: string[] = [];

  for (const it of items) {
    parts.push(it);
  }

  return parts.sort().join('|');
}
