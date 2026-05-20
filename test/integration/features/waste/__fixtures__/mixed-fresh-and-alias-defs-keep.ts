// KEEP boundary: case 6/7 requires *every* def of the variable to be a fresh
// allocation. If one branch assigns a fresh `[]` and another aliases an outer
// reference, the mutation site (`c.push(1)`) reaches both — dropping the
// fresh-allocation def would not actually eliminate the externally observable
// mutation on the alias path.

export function f(cond: boolean, arg: number[]): void {
  let c: number[];

  if (cond) {
    c = [];
  } else {
    c = arg;
  }

  c.push(1);
}
