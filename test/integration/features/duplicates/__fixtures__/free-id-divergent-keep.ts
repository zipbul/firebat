function readAsNumber(raw: string): number {
  const parsed = Number(raw);
  const doubled = parsed * 2;
  return doubled;
}

function readAsInt(raw: string): number {
  const parsed = parseInt(raw);
  const doubled = parsed * 2;
  return doubled;
}
