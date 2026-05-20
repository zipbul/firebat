// KEEP boundary: case 6/7 is only safe when the binding holds a *fresh
// allocation*. An alias to a parameter (or any outer reference) shares the
// underlying object — mutations through the alias are visible to the caller,
// so removing the alias + its mutations would change observable behavior.
// `FRESH_ALLOCATION_TYPES` covers ArrayExpression / ObjectExpression /
// ClassExpression only; everything else (Identifier, MemberExpression, ...)
// disqualifies the binding from the case 6/7 path.

export function f(arg: number[]): void {
  const arr = arg;
  arr.push(1);
}
