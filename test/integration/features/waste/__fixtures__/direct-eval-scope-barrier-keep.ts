// KEEP boundary: a scope containing a direct `eval(...)` call may read any
// local binding by name through the opaque string argument. Static reaching-
// defs cannot prove any def is unobserved. waste skips the entire scope.

export function f(): number {
  let secret = 1;

  // eslint-disable-next-line no-eval
  eval('secret');
  secret = 2;

  return secret;
}
