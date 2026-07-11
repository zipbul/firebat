// W: `s` aliases the LOCAL parameter `seed`. The intervening `sideEffect()` call cannot reassign a
// caller's parameter, so `s` is a stable redundant alias — inlining `seed` preserves behavior. The
// free-vs-local test must resolve `seed` to the parameter (local) scope-aware; the earlier bare-name
// bug held every identifier-RHS with an intervening effect, wrongly suppressing this real report.
export function make(seed: string): string {
  const s = seed;

  sideEffect();

  return s + '!';
}

function sideEffect(): void {}
