export function f(): unknown[] {
  return [[1], [2]].flatMap(async (i) => i);
}
