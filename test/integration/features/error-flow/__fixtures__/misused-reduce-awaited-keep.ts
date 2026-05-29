export async function f(items: number[]): Promise<number> {
  return items.reduce(async (a, b) => (await a) + b, Promise.resolve(0));
}
