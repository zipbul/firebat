export function silentFail(input: string): string {
  try {
    return input.toUpperCase();
  } catch {
  }

  return '';
}
