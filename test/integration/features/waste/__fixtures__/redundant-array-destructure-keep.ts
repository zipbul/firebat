// KEEP (Phase2): array destructuring consumes the iterator at declaration time;
// inlining as an index read would re-run iterator protocol / differ for non-arrays.
export function f(iterable: Iterable<number>): number {
  const [x] = iterable;
  return x + 1;
}
