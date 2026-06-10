function parseValue(input: string): number;
function parseValue(input: number): string;
function parseValue(input: unknown): unknown {
  if (typeof input === 'string') {
    return Number(input);
  }
  return String(input);
}
