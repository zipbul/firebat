// DEAD (case 7): `delete c.p` on a fresh ObjectExpression that does not escape
// is a local-only mutation — the delete observably modifies only `c`'s own
// property set, and `c` is never read or escaped. Both the binding and the
// delete site can be removed without changing observable behavior.

export function f(): void {
  const c: { p?: number } = { p: 1 };

  delete c.p;
}
