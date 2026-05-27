// KEEP (FP-A): `x = null` reference release (trpc dataLoader pattern). Dead
// `= null` reassignment after escape = lifetime management.
function sink(_v: object): void {}
export function f(): number {
  let x: object | null = { big: 1 };
  sink(x);
  x = null;
  return 0;
}
