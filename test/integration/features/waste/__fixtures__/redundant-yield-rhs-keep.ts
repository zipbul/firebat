// K — RHS contains a yield expression (impure: suspends + receives a value).
// Inlining the binding would move the yield, changing await/yield position.
export function* gen(source: () => number): Generator<number, number, number> {
  const received = yield source();

  return received + 1;
}
