// KEEP boundary: the IIFE's write is conditional (`if (c) x = 2`), so on the
// no-write path `x = 1` survives to the read. Inlining models the branch, so
// the init is correctly kept.
export function f(c: boolean): number {
  let x = 1;
  (() => {
    if (c) {
      x = 2;
    }
  })();

  return x;
}
