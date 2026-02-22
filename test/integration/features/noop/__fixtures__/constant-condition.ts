export function alwaysTrue(x: number): number {
  if (true) {
    return x + 1;
  }

  return x;
}
