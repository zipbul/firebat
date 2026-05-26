// DEAD: a switch WITH a default is total — every path assigns `i` before the
// read, so the `let i = 0` initializer is never observed.
export function f(n: number): number {
  let i = 0;

  switch (n) {
    case 1: i = 10; break;
    default: i = 99; break;
  }

  return i;
}
