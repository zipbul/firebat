export function decide(a: boolean, b: boolean, c: boolean): number {
  let result = 0;

  if (a) {
    result += 1;
  }

  if (b) {
    result += 2;
  }

  if (c) {
    result += 4;
  }

  return result;
}
