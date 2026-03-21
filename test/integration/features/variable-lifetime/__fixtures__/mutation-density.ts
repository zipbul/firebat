// Fixture: mutation-density finding.
// Variable `result` has 4 non-declaration, non-loop writes → exceeds maxMutationCount: 3.
// Variable `sum` uses compound-assignment inside a loop → suppressed.
export function processMutations(items: number[]): string {
  let result = '';
  result = 'step1';
  result = 'step2';
  result = 'step3';
  result = 'step4';

  let sum = 0;
  for (const item of items) {
    sum += item;
  }

  return result + String(sum);
}
