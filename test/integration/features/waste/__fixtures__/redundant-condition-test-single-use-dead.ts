// DEAD (Phase2): a boolean bound once and read once in a ternary condition.
// Inlining `(e instanceof Error)` preserves runtime AND TS 4.4 alias narrowing
// (`e.message` in the true branch stays valid after inlining).
export function f(e: unknown): string {
  const ok = e instanceof Error;
  return ok ? (e as Error).message : 'x';
}
