// KEEP boundary: user-defined setter is invoked by property write.
// `c.x = v` runs the setter body — observable side-effects. ObjectExpression
// literals with any get/set/method definition disable case 6/7 for the whole
// variable.

export function f(): void {
  const c = {
    set x(v: number) {
      console.log(v);
    },
  };

  c.x = 42;
}
