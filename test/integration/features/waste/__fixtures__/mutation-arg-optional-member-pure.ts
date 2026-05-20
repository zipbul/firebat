// case 6 boundary (DEAD): optional MEMBER access (no call) in argument is pure.
// `obj?.b` is a read, not a call — `ChainExpression` wrapping a `MemberExpression`
// has no side-effect. Only `ChainExpression` wrapping a `CallExpression` (e.g.
// `obj?.m()`) is impure, caught by child recursion of `CallExpression`.

export function f(obj: { b?: number } | null): void {
  const c: number[] = [];

  c.push(obj?.b ?? 0);
}
