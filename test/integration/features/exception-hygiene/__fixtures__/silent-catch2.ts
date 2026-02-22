export function parseData(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch (_err) {}

  return undefined;
}
