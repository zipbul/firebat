export function mapItems(items: string[], transform: (s: string) => string): string[] {
  const result: string[] = [];
  for (let i = 0; i < items.length; i++) {
    result.push(transform(items[i]));
  }
  return result;
}

export function filterItems(items: string[], keep: (s: string) => boolean): string[] {
  const output: string[] = [];
  for (let j = 0; j < items.length; j++) {
    if (keep(items[j])) {
      output.push(items[j]);
    }
  }
  return output;
}
