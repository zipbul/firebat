// KEEP boundary: computed property key with a side-effect.
// `obj[g()] = 1` evaluates g() every time the assignment runs. Removing the
// assignment would erase the call. classifyUseInWaste falls back to 'real' for
// any computed MemberExpression whose `property` subtree is impure.

declare function g(): string;

export function f(): void {
  const obj: Record<string, number> = {};

  obj[g()] = 1;
}
