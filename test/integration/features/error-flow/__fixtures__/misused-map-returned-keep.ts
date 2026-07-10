export function f(): Array<Promise<number>> {
  return [1, 2, 3].map(async (i) => i + 1);
}
