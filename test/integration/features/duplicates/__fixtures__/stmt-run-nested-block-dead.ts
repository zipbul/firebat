function processA(flag: boolean, xs: number[]): number {
  if (flag) {
    const seen = new Set<number>();
    for (const x of xs) {
      seen.add(x);
    }
    const count = seen.size;
    const weighted = count * 3;
    recordA(weighted);
  }
  return finalizeA();
}

function processB(flag: boolean, xs: number[]): number {
  warmUp();
  if (flag) {
    const seen = new Set<number>();
    for (const x of xs) {
      seen.add(x);
    }
    const count = seen.size;
    const weighted = count * 3;
    recordA(weighted);
  }
  return finalizeB();
}
