function buildA(rows: number[]): number {
  const acc = [];
  for (const row of rows) {
    acc.push(row * 2);
  }
  const head = acc[0];
  return head + 1;
}

function buildB(rows: number[]): number {
  const out = [];
  for (const row of rows) {
    out.push(row * 2);
  }
  const lead = out[0];
  return lead * 10;
}
