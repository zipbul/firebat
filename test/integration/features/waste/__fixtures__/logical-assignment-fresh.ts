// case 6 (DEAD): logical assignment with fresh RHS.
// `c ??= []` either keeps c as the prior fresh value or replaces it with another
// fresh one. The LHS read is a condition check (not a value flow), so it counts
// as 'mutation' for case 6/7. `varHasOnlyFreshDefs` requires the original
// declaration init *and* the logical-assignment RHS to both be fresh.

export function f(): void {
  let c: number[] = [];
  c ??= [];
  c.push(1);
}
