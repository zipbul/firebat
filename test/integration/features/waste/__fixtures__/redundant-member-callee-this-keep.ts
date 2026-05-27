// KEEP (Phase2): a member read aliased then used as a call callee. Inlining
// `handle(ctx)` → `handlers[i](ctx)` changes the call receiver (this), which a
// non-arrow method would observe. CLAUDE.md K (context-sensitive this).
export function f(handlers: Array<(c: number) => number>, i: number, ctx: number): number {
  const handle = handlers[i];
  return handle(ctx);
}
