// KEEP (Phase2): the source `cur` is reassigned via a destructuring assignment
// (`({ cur } = src)`), which a bare-identifier reassignment check misses. Inlining
// `y`→`cur` would read the reassigned value, changing the return.
export function f(src: { cur: number }): number {
  let cur = 0;
  const y = cur;
  ({ cur } = src);
  return y + cur;
}
