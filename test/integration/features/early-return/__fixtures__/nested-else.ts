export function classify(value: number): string {
  if (value > 0) {
    if (value < 10) {
      return 'small';
    } else {
      return 'large';
    }
  } else {
    return 'non-positive';
  }
}
