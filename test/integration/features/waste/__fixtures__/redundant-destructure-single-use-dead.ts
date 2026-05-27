// DEAD (Phase2): destructuring binding used once (CLAUDE.md "destructuring binding"
// 대상). `const { a } = obj` → inline `obj.a`, nothing between → W.
export function f(obj: { a: number }): number {
  const { a } = obj;
  return a + 1;
}
