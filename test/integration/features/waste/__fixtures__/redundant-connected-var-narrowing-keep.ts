// KEEP (Phase2): narrowing of the source flows through a derived boolean
// (`hasValue = x !== undefined`); the guard tests the derived var, not the source.
// The source appearing in a type-test between decl and use is the narrowing signal.
// (`y` must be kept; `hasValue` is used twice so it is not itself a candidate.)
declare function pick(s: string): { a: number };
declare function pick(s: string | undefined): { a: number; b: number };
export function f(x: string | undefined): number {
  const y = x;
  const hasValue = x !== undefined;
  if (hasValue) {
    return pick(y).b;
  }
  return hasValue ? 0 : 1;
}
