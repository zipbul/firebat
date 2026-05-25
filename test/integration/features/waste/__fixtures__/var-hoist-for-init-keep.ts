// KEEP boundary: `var` declarations hoist to the enclosing function scope.
// `var c` inside the for-init binds the same `c` as `return c` after the loop.
// oxc-walker's ScopeTracker doesn't model var hoisting; buildDeclScopeMap
// normalizes by re-mapping all hoisted-var references to a synthetic
// function-scope key (`var:<funcOffset>:<name>`).

export function f(cond: boolean): number[] {
  for (var c: number[] = []; cond; ) {
    c.push(1);

    break;
  }

  return c;
}
