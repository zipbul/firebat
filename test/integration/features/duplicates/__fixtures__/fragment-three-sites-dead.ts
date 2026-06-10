function one(xs: number[]): number {
  startOne();
  const acc = new Set<number>();
  for (const x of xs) {
    acc.add(x * 2);
  }
  const size = acc.size;
  return size + 1;
}

function two(ys: number[]): number {
  beginTwo();
  other();
  const acc = new Set<number>();
  for (const x of ys) {
    acc.add(x * 2);
  }
  const size = acc.size;
  return size + 2;
}

function three(zs: number[]): number {
  initThree();
  const acc = new Set<number>();
  for (const x of zs) {
    acc.add(x * 2);
  }
  const size = acc.size;
  return size + 3;
}
