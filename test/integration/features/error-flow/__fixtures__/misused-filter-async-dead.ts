export async function f(): Promise<unknown[]> {
  return Promise.all([1, 2, 3].filter(async (i) => i > 0));
}
