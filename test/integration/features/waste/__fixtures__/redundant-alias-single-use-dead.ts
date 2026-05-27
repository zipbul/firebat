// DEAD (Phase2): single-use pure identifier alias. `s` just renames SECRET.
export function f(SECRET: string): string {
  const s = SECRET;
  return s + '!';
}
