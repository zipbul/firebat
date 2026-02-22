export function getItem(items: string[], index: number): string {
  if (items.length === 0) throw new Error('empty array');

  const item = items[index];

  if (item === undefined) throw new Error(`index ${index} out of bounds`);

  return item;
}
