// KEEP boundary: user-defined method shadows a built-in mutation name.
// `c.set(...)`/`c.push(...)` on an ObjectExpression literal calls the user's
// method, not `Map.set`/`Array.prototype.push`. The receiver's static type
// (ObjectExpression with a user method/getter/setter) disqualifies the
// MUTATION_METHODS whitelist for the entire variable.

export function f(): void {
  const c = {
    set(k: string, v: number): void {
      console.log(k, v);
    },
  };

  c.set('a', 1);
}
