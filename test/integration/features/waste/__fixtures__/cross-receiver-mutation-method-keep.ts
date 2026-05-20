// KEEP boundary: mutation method whitelist matches by NAME, but the receiver
// init kind must support that prototype. `[].set(...)` and `{}.push(...)` are
// `TypeError: ... is not a function` at runtime — an observable side-effect.
// MUTATION_METHODS is split into ARRAY (push/pop/shift/unshift/splice/sort/
// reverse/fill/copyWithin) and MAPSET (set/add/delete/clear); use sites are
// validated against the receiver's fresh-allocation kind.

export function f(): void {
  const arr: unknown = [];

  (arr as { set: (k: number, v: number) => void }).set(0, 1);
}

export function g(): void {
  const o: unknown = {};

  (o as { push: (v: number) => void }).push(1);
}
