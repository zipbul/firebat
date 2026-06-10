function normalizePrice(amount: number, factor: number): number {
  const reduced = amount - amount * factor;
  const snapped = Math.round(reduced);
  return snapped;
}
