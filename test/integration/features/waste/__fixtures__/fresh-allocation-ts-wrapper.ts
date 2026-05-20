// case 6 boundary (DEAD): TS value wrappers preserve fresh-allocation identity.
// `[] as number[]`, `[] satisfies T`, `([])`, `<T>[]`, `[]!` all still hold a
// brand-new array. `unwrapValueWrappers` peels these off before checking
// `FRESH_ALLOCATION_TYPES`, so case 6/7 still fires through them.

export function f(): void {
  const c = [] as number[];

  c.push(1);
}
