// DEAD (Phase2): single-use computed literal-key index read. No getter bypass
// (non-Proxy), no call between decl and use.
export function f(tuple: [number, string]): string {
  const second = tuple[1];
  return second.toUpperCase();
}
