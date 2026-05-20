// case 6 boundary (DEAD): assignment def — not just declaration — qualifies for
// case 6/7 when its RHS is a fresh allocation. `let c: number[]; c = []; c.push(1);`
// is identical in effect to `const c: number[] = []; c.push(1);` from waste's
// perspective. The fresh-allocation guard still excludes alias assignments
// (`let c; c = arg; c.push(1)`).

export function f(): void {
  let c: number[];
  c = [];
  c.push(1);
}
