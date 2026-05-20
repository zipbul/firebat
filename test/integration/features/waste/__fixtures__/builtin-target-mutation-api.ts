// case 7 (DEAD): well-known built-in target-mutation APIs.
// `Object.assign(target, ...sources)`, `Object.defineProperty`, `Reflect.set`,
// etc. treat the first argument as a mutation receiver and the rest as read-
// only sources. When `c` is a fresh allocation and the sources are pure, the
// whole call is local-mutation-only and `c` is dead.

export function f(): void {
  const c = {};

  Object.assign(c, { x: 1 });
}
