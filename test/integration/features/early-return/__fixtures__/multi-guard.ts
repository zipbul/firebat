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
