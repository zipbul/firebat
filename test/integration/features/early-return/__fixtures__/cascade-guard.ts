// Fixture: cascade-guard — 3-branch else-if chain, all non-final branches end in return
export function handle(x: number): string {
  if (x < 0) {
    return 'negative';
  } else if (x === 0) {
    return 'zero';
  } else if (x > 100) {
    return 'big';
  } else {
    const a = String(x);
    const b = a.padStart(2, '0');
    const c = b + '!';

    return c;
  }
}
