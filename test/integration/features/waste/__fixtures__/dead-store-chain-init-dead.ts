// DEAD (FN D fixed): chained dead stores. `x = 5` overwrites before the read,
// so `x += 2` is dead; because `x += 2` is a side-effect-free dead store, its
// read of `x` is eliminated, which in turn makes the `x = 1` init dead too.
export function f(): number {
  let x = 1;
  x += 2;
  x = 5;

  return x;
}
