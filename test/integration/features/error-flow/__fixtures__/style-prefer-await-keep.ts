export async function f(g: () => Promise<number>): Promise<number> {
  return g()
    .then((x) => {
      return x;
    })
    .then((y) => {
      return y + 1;
    });
}
