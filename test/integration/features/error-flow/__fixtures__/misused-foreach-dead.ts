export function f(): void {
  [1, 2, 3].forEach(async (i) => {
    await Promise.resolve(i);
  });
}
