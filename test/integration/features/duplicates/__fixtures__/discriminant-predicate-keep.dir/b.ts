export function isHighComplexity(c: { kind: string }): boolean {
  return c.kind === 'high-cognitive-complexity';
}
