// KEEP (Phase2): a call sits between the property read and its use; the call may
// mutate `o.p`. No alias analysis → conservatively skip.
export function f(o: { p: number }, side: () => void): number {
  const v = o.p;
  side();
  return v;
}
