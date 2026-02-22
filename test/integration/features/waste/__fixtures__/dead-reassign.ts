export function compute(items: string[]): number {
  let count = 0;

  for (const item of items) {
    count = item.length;
  }

  return count;
}
