// KEEP (Phase2): the receiver's property is written inside the loop where the
// snapshot is used. Inlining re-reads the mutated property each iteration.
export function f(o: { n: number }): number {
  const y = o.n;
  let total = 0;
  while (total < y) {
    total = total + 1;
    o.n = o.n - 1;
  }
  return total;
}
