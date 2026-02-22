export function buildReport(data: number[]): string {
  const sorted = [...data].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, x) => acc + x, 0);
  const avg = sum / sorted.length;
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  const lines: string[] = [];

  for (const d of sorted) {
    if (d > avg) {
      lines.push(`${d} (above avg)`);
    } else {
      lines.push(`${d}`);
    }
  }

  return `min=${min} max=${max} avg=${avg}\n${lines.join('\n')}`;
}
