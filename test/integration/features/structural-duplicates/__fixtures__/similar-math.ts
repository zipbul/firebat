export function processItems(items: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < items.length; i++) {
    result.push(items[i].trim());
  }
  return result;
}

export function cleanElements(elements: string[]): string[] {
  const output: string[] = [];
  for (let j = 0; j < elements.length; j++) {
    output.push(elements[j].trim());
  }
  return output;
}
