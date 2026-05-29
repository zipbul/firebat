export async function f(items: number[]): Promise<unknown[]> {
  return Promise.all(items.filter(async (i) => i > 0));
}
