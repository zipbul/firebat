// KEEP (Phase2): an early-exit guard narrows the source AFTER the alias declaration
// (sibling statement, not a branch the use is nested in). With overloads, inlining
// y→x selects a different overload — the TS type-check result changes (PASS→FAIL).
declare function pick(s: string): { a: number };
declare function pick(s: string | undefined): { a: number; b: number };
export function f(x: string | undefined): number {
  const y = x;
  if (x === undefined) {
    throw new Error('nope');
  }
  return pick(y).b;
}
