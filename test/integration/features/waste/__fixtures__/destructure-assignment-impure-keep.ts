// KEEP boundary: destructure *assignment* (not declaration) with impure RHS.
// `[a] = g()` calls g() — removing the assignment would erase the call.
// findDefRhs unwraps Pattern parents to either VariableDeclarator OR
// AssignmentExpression (whichever encloses), so this matches the same purity
// guard the declaration form uses.

declare function g(): number[];

export function f(): number {
  let a: number;
  [a] = g();
  a = 1;

  return a;
}
