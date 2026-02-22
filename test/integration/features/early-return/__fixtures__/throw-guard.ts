export function requirePositive(n: number): void {
  if (n <= 0) throw new RangeError(`Expected positive number, got ${n}`);
  console.log(n);
}

export function requireNonEmpty(arr: unknown[]): void {
  if (arr.length === 0) throw new TypeError('Array must not be empty');
  console.log(arr);
}
