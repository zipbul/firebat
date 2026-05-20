// KEEP boundary: a computed-key property whose value is a function literal
// is semantically a method (e.g. `[Symbol.toPrimitive]: () => ...`). Object
// coercion / spread / well-known-symbol lookups invoke these methods, so the
// receiver carries observable behavior beyond own-property data.
// objectInitDefinesMethodOrAccessor disqualifies the variable from case 6/7.

export function f(): void {
  const obj: { x?: number } = {
    [Symbol.toPrimitive]: () => {
      console.log('p');

      return 1;
    },
  } as { x?: number };

  obj.x = 1;
}
