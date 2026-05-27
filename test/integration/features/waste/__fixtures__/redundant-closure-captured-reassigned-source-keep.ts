// KEEP (Phase2): captured by a closure and the source `x` is reassigned after the
// alias. The closure runs later, so inlining `() => x` would read the new value.
export function f(): [number, () => number] {
  let x = 1;
  const y = x;
  x = 2;
  return [x, () => y];
}
