export async function f(): Promise<number[]> {
  return Promise.all([1, 2, 3].map(async (i) => i + 1));
}
