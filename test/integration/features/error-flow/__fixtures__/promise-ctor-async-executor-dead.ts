export function f(): Promise<number> {
  const p = new Promise<number>(async (resolve) => {
    resolve(await Promise.resolve(1));
  });
  return p;
}
