// KEEP boundary: `{ __proto__: parent }` installs a prototype at literal
// time. Subsequent property writes/reads can fire inherited accessors or
// throw against inherited frozen/readonly slots — the receiver is no longer
// a clean own-property-only fresh allocation. objectInitDefinesMethodOrAccessor
// treats any `__proto__` literal key as disqualifying for case 6/7.

export function f(): void {
  const proto = {
    set x(v: number) {
      console.log(v);
    },
  };

  const o: { x?: number } = { __proto__: proto } as { x?: number };

  o.x = 1;
}
