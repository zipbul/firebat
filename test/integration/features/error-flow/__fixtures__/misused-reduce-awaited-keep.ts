export async function f(): Promise<number> {
  return [1, 2, 3].reduce(async (a, b) => (await a) + b, Promise.resolve(0));
}
