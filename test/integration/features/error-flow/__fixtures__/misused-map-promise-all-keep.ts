export async function f(items: number[]): Promise<number[]> {
  return Promise.all(items.map(async (i) => i + 1));
}
