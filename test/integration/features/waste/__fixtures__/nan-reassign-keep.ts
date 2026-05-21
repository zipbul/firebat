// KEEP boundary: `let x = NaN; x = NaN;` looks like case-3 (same-value
// reassign) at the syntactic level, but at runtime `NaN !== NaN`. A
// later NaN reassignment exempts the earlier NaN def from being
// reported, so the syntactic same-value heuristic does not surface
// behavior-changing reports.

export function f(): number {
  let x = NaN;

  x = NaN;

  return x;
}
