export function f(p: Promise<number>): void {
  p.then(
    (x) => console.log(x),
    (e) => console.error(e),
  );
}
