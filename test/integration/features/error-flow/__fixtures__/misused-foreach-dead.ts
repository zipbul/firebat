export function f(items: number[]): void {
  items.forEach(async (i) => {
    await Promise.resolve(i);
  });
}
