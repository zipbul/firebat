function alpha(xs: number[]): number {
  warmAlpha();
  const seen = new Set<number>();
  for (const x of xs) {
    seen.add(x);
  }
  const total = seen.size;
  return total + 1;
}

function beta(ys: number[]): number {
  prepBeta();
  logStart();
  const seen = new Set<number>();
  for (const x of ys) {
    seen.add(x);
  }
  const total = seen.size;
  return total + 1;
}
