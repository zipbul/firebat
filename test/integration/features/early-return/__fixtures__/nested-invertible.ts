// Fixture: nested invertible — depth>0 invertible-if-else detection
export function processItems(items: string[]): string[] {
  const results: string[] = [];

  for (const item of items) {
    if (item.length === 0) {
      continue;
    } else {
      const trimmed = item.trim();
      const upper = trimmed.toUpperCase();
      const result = upper.replace(/\s+/g, '-');

      console.log(result);

      results.push(result);
      doExtra(result);
    }
  }

  return results;
}

function doExtra(_s: string): void {}
