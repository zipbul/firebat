export function f(p: Promise<number>): Promise<number> {
  return p.then((x) => Promise.resolve(x + 1));
}
