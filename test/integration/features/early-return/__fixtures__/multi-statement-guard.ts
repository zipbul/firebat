// Fixture: multi-statement guard — guard block with 2+ statements should be recognized
export function handle(input: unknown): string {
  if (!input) {
    console.log('invalid input');
    return 'error';
  }

  const str = String(input);
  return str.toUpperCase();
}
