export function f(items: number[]): Array<Promise<number>> {
  return items.map(async (i) => i + 1);
}
