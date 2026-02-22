export function processItems(items: number[]): number[] {
  const result: number[] = [];

  for (let i = 0; i < items.length; i++) {
    for (let j = 0; j < items.length; j++) {
      if (items[i] !== items[j]) {
        result.push(items[i] + items[j]);
      }
    }
  }

  return result;
}
