// KEEP (Phase2): a call sits between the index read and its use; the call may
// mutate the receiver/slot. No alias analysis → conservatively skip.
export function f(bb: [number], side: () => void): number {
  const x = bb[0];
  side();
  return x;
}
