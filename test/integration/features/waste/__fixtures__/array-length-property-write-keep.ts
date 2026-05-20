// KEEP boundary: array length writes are property writes, not whitelisted local
// mutation calls. Treating `c.length = ...` as case 6/7 waste is too broad.

export function f(): void {
  const c: number[] = [];

  c.length = 0;
}
