// DEAD (Phase2): single-use arith over a member read. getter-safety is
// irrelevant for single-use inline (1 eval, same position). gate6 only.
export function f(res: { status: number }): string {
  const ok = res.status === 200;
  return ok ? 'y' : 'n';
}
