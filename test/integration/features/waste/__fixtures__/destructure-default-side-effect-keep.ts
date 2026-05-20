// KEEP boundary: destructure default expression has a side-effect even when the
// init itself is pure. `let { a = sideEffect() } = obj` evaluates the default only
// when `obj.a === undefined`, but statically we cannot prove the default never
// runs. Dropping the binding would (potentially) erase the call.

declare function sideEffect(): number;

export function f(input: { a?: number }): number {
  let { a = sideEffect() } = input;

  a = 1;

  return a;
}
