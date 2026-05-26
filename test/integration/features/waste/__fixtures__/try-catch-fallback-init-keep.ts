// KEEP boundary: a fallback init read on the exception path. If `compute()`
// throws before the assignment completes, `x` keeps its `[]` init and is read
// after the try/catch. The CFG models the exception edge from the try entry to
// the catch (pre-assignment state), so the init reaches the post-try read and
// is NOT a dead store. Common defensive pattern.
declare function compute(): number[];

export function f(): number {
  let x: number[] = [];

  try {
    x = compute();
  } catch {
    // swallow
  }

  return x.length;
}
