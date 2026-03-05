// Fixture: deeply nested if-else — no guard clauses (all branches are if-else, not guard pattern)
export function process(a: unknown, b: unknown, c: unknown): string {
  if (a) {
    if (b) {
      if (c) {
        return 'all';
      } else {
        return 'no-c';
      }
    } else {
      return 'no-b';
    }
  } else {
    return 'no-a';
  }
}
