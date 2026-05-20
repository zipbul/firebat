// KEEP boundary: compound assignment reads the old value and may run object
// coercion (`valueOf` / `toString`) before writing the local variable. For
// non-primitive reaching values, removing the compound assignment can erase
// observable coercion behavior even when the final value is never consumed.

export function f(): void {
  let c: number[] = [];

  c += 'x';
}
