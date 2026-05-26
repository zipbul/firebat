// KEEP boundary: a default-less switch is not total. If the discriminant
// matches no case, no case body runs and the `let i = 0` initializer survives
// to the post-switch read. The CFG models the no-match fall-through edge, so
// the init is live (and removing it would break TS definite-assignment).
// (Found in typeorm RandomGenerator.)
export function f(n: number): number {
  let i = 0;

  switch (n % 4) {
    case 0: i = 10; break;
    case 1: i = 20; break;
    case 2: i = 30; break;
    case 3: i = 40; break;
  }

  return i;
}
