// KEEP (Phase2): an assertion call narrows the source after the alias. Inlining
// y→x feeds the narrowed type to an overloaded call, changing the TS result.
declare function assertIsString(v: unknown): asserts v is string;
declare function pk(s: string): { a: number };
declare function pk(s: unknown): { a: number; b: number };
export function f(x: unknown): number {
  const y = x;
  assertIsString(x);
  return pk(y).b;
}
