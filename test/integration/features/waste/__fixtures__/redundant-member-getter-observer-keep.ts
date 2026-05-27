// KEEP (Phase2): the member RHS may be a side-effecting getter; an intervening
// statement reads state that the getter could mutate, so moving the member
// evaluation to the use changes observable order. CLAUDE.md K (side-effect order).
export function f(src: { prop: number }, counter: number): number {
  const y = src.prop;
  void counter;
  return y;
}
