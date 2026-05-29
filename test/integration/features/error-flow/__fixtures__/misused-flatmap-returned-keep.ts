export function f(items: number[][]): unknown[] {
  return items.flatMap(async (i) => i);
}
