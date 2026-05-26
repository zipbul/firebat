// DEAD (FN G fixed): a sync IIFE overwrites an outer variable that is read
// after the call. The IIFE runs immediately, so `x = 2` supersedes `x = 1`
// before `return x` reads it. The CFG inlines sync zero-param IIFEs, so the
// outer dataflow sees the write.
export function f(): number {
  let x = 1;
  (() => {
    x = 2;
  })();

  return x;
}
