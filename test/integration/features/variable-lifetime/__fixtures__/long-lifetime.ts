export function computeWithLongLifetime(): number {
  const base = 100;

  const a = base * 2;
  const b = a + 1;
  const c = b - 3;
  const d = c * 4;
  const e = d / 2;

  return base + e;
}
