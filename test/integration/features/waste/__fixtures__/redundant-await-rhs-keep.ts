// KEEP (Phase2): RHS is an await expression (impure, suspension point). Excluded
// from single-use inline — the declaration itself carries a side-effect/order.
export async function f(p: Promise<number>): Promise<number> {
  const v = await p;
  return v + 1;
}
