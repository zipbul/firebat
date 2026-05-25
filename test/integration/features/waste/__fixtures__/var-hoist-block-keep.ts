// KEEP boundary: `var` inside an `if`-block hoists to the function scope.
// The outer reference must resolve to the same binding as the inner declaration.

export function f(flag: boolean): number {
  if (flag) {
    var x = 1;
  } else {
    var x = 2;
  }

  return x;
}
