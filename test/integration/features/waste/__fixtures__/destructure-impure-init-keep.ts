// KEEP boundary: destructure binding whose enclosing init has a side-effect.
// `let { a } = sideEffect()` cannot be dropped — removing the binding would
// erase the call. `findDefRhs` walks pattern wrappers up to the
// VariableDeclarator and returns the declarator itself, so
// `containsImpureExpression` inspects both the pattern (defaults) and the init.

declare function sideEffect(): { a: number; b: number };

export function f(): number {
  let { a, b } = sideEffect();

  a = 1;
  b = 2;

  return a + b;
}
