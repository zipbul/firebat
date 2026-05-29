export async function f(p: Promise<number>): Promise<void> {
  await p.then((r) => {
    console.log(r);
  });
}
