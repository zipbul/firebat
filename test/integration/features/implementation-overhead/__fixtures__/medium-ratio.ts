export function transform(input: string, options: Record<string, boolean>): string {
  let result = input.trim();

  if (options['uppercase']) {
    result = result.toUpperCase();
  }

  if (options['reverse']) {
    result = result.split('').reverse().join('');
  }

  return result;
}
