// KEEP boundary: case 1/4 declaration with impure initializer (e.g. function call).
// `let x = sideEffect()` then `x = 1` overwrites the value, but the initializer
// itself has a side-effect that must be preserved. Removing `x = sideEffect()`
// would erase the call. CLAUDE.md "side-effect 횟수·순서 보존".
//
// Per-def purity guard in the detector loop runs `findDefRhs(ctx)` →
// `containsImpureExpression(rhs)` and skips emit when the RHS is impure.

declare function sideEffect(): number;

export function f(): number {
  let x = sideEffect();

  x = 1;

  return x;
}
