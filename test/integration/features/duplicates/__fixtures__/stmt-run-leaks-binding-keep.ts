function alpha(xs: number[]): number {
  let total = 0;
  for (const x of xs) {
    total += x;
  }
  const avg = total / xs.length;
  return avg > 10 ? total : avg;
}

function beta(xs: number[]): string {
  let total = 0;
  for (const x of xs) {
    total += x;
  }
  const avg = total / xs.length;
  return 'sum=' + String(total + avg);
}
