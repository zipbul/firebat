// KEEP (Phase2): the alias is used inside a branch that narrows its SOURCE. TS
// narrows `input` (string) in the guarded block but not the separate binding `y`
// (string | number). Inlining `y`→`input` would change the TS type-check result.
export function f(input: string | number): void {
  const y = input;
  if (typeof input === 'string') {
    const s: string = y;
    console.log(s);
  }
}
