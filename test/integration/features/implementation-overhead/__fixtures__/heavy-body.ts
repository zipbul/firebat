export function processAll(items: string[]): string[] {
  const results: string[] = [];

  for (const item of items) {
    if (item.length > 0) {
      const trimmed = item.trim();

      if (trimmed.includes('_')) {
        results.push(trimmed.replace(/_/g, '-'));
      } else {
        results.push(trimmed.toUpperCase());
      }
    }
  }

  return results;
}
