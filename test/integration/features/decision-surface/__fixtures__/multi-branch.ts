export function classify(type: string, value: number, flag: boolean): string {
  if (type === 'a') {
    return 'type-a';
  }

  if (type === 'b') {
    return 'type-b';
  }

  if (value > 100) {
    return 'high';
  }

  if (flag) {
    return 'flagged';
  }

  return 'default';
}
