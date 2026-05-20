// case 6 KEEP boundary: `delete obj.p` in argument has the deletion side-effect.
// Dropping the push would also drop the delete. UnaryExpression with operator
// 'delete' is treated as impure.

export function f(obj: { p?: number }): void {
  const c: boolean[] = [];

  c.push(delete obj.p);
}
