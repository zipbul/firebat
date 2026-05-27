// KEEP (Phase2): captured by a closure AND RHS is a call. Inlining `() => resolve()`
// would run resolve() once per invocation → side-effect count changes (trpc httpLink).
function resolve(): number { return 1; }
export function f(): () => number {
  const opts = resolve();
  return () => opts;
}
