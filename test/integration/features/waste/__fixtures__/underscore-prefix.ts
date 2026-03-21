export function transform(items: string[]): number {
  const _skipped = items.filter(x => x.length > 10); // intentionally ignored
  const _debug = items.map(x => x.toUpperCase()); // intentionally ignored
  return items.length;
}
