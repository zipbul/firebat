// case 6 boundary (DEAD): function literal in argument is pure.
// `c.push(() => g())` does NOT call `g()` — the arrow body is evaluated only when
// the stored function is later invoked. Dropping the push removes the function value
// without removing any call, so `c` is dead. `containsImpureExpression` returns false
// at function/arrow nodes (their body is value-time, not push-time).

declare function g(): number;

export function f(): void {
  const c: Array<() => number> = [];

  c.push(() => g());
}
