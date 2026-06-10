function processOrders(ids: string[]): number {
  const seen = new Set<string>();
  for (const id of ids) {
    seen.add(id.trim());
  }
  const unique = seen.size;
  const weighted = unique * 3;
  return weighted > 50 ? 50 : weighted;
}

function processRefunds(ids: string[]): string {
  const seen = new Set<string>();
  for (const id of ids) {
    seen.add(id.trim());
  }
  const unique = seen.size;
  return unique > 0 ? 'has' : 'none';
}
