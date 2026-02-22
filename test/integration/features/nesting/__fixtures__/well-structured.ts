export function classify(score: number): string {
  if (score >= 90) {
    return 'excellent';
  }

  if (score >= 70) {
    return 'good';
  }

  return 'needs-improvement';
}
