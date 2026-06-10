function processOrder(ids: string[]): number {
  const seen = new Set<string>();
  for (const id of ids) {
    seen.add(id);
  }
  const count = seen.size;
  const weighted = count * 3;
  if (weighted > 50) {
    return 50;
  }
  const tail = ids.length - count;
  return weighted + tail;
}

function auditRefund(ids: string[], limit: number): string {
  const seen = new Set<string>();
  for (const id of ids) {
    seen.add(id);
  }
  const count = seen.size;
  let label = 'none';
  if (count > limit) {
    label = 'over';
  } else if (count === limit) {
    label = 'exact';
  }
  const suffix = label.toUpperCase();
  return suffix + String(limit);
}
