export function deepCheck(a: boolean, b: boolean, c: boolean): string {
  if (a) {
    if (b) {
      if (c) {
        return 'a+b+c';
      }

      return 'a+b';
    }

    return 'a';
  }

  return 'none';
}
