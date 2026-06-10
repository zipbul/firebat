function alpha(xs: number[]): number {
  beginWork();
  const seen = new Set<number>();
  for (const x of xs) {
    seen.add(x);
  }
  return seen.size;
}

function bravo(xs: number[]): number {
  beginWork();
  const seen = new Set<number>();
  for (const x of xs) {
    seen.add(x);
  }
  return seen.size;
}
