// Fixture: else-if chain — verifies countStatements without +1 per IfStatement branch
export function categorize(value: number): string {
  if (value < 0) {
    return 'negative';
  } else if (value === 0) {
    return 'zero';
  } else if (value < 10) {
    return 'small';
  } else {
    const msg = `large: ${value}`;
    console.log(msg);
    return msg;
  }
}
