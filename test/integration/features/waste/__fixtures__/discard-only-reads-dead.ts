// DEAD (case 7): a fresh allocation whose only "reads" are discarded
// expression contexts (`typeof`, `void`, sequence non-last position,
// `instanceof` in an ExpressionStatement). Removing the binding together
// with the discarded read preserves observable behavior — the read's value
// is never consumed.

export function f(): void {
  const c: number[] = [];

  void c;
}
