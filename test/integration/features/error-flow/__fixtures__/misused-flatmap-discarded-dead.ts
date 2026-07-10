export function f(): void {
  [[1], [2]].flatMap(async (i) => i);
}
