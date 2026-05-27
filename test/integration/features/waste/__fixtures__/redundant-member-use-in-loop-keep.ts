// KEEP (Phase2): a member read whose single syntactic use is inside a loop is
// re-evaluated each iteration once inlined — execution count changes. A
// side-effecting getter would diverge (or loop forever).
export function f(obj: { prop: number }): number {
  const v = obj.prop;
  let total = 0;
  while (total < v) {
    total = total + 1;
  }
  return total;
}
