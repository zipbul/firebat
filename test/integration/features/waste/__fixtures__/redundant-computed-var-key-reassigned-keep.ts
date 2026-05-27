// KEEP (Phase2): computed key is a variable that is reassigned between the index
// read and its use. Inlining `arr[i]` would read a different slot.
export function f(arr: number[], i: number): number {
  const x = arr[i];
  i = 0;
  return x + i;
}
