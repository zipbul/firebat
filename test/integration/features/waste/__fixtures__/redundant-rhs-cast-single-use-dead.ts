// DEAD (Phase2): RHS is an `as` cast over a pure identifier, single use. Inlining
// `(e as string)` preserves type-check and behavior (cast travels with the value).
export function f(e: unknown): string {
  const s = e as string;
  return s + '!';
}
