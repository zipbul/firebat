// KEEP (Phase2): the alias is used inside a do-while body whose guard narrows the
// source. Inlining `y`→`x` would change the TS type-check result.
declare function maybeNull(): string | null;
declare function consume(value: string): void;
export function f(): void {
  const x: string | null = maybeNull();
  const y = x;
  do {
    consume(y as string);
  } while (x !== null);
}
