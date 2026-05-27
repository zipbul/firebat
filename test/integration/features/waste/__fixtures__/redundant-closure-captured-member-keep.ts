// KEEP (Phase2): a monkey-patch — the original method is captured, then the
// receiver's property is overwritten with a wrapper that calls the capture.
// Inlining `api.m` into the wrapper would self-reference the new value (recursion).
export function f(api: { m: () => number }): void {
  const orig = api.m;
  api.m = () => orig();
}
