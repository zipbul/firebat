function runOne(items: number[]): number {
  const mapped = [];
  for (const item of items) {
    mapped.push(transformOne(item));
  }
  return mapped.length;
}

function runTwo(items: number[]): number {
  const mapped = [];
  for (const item of items) {
    mapped.push(transformTwo(item));
  }
  return mapped.length;
}
