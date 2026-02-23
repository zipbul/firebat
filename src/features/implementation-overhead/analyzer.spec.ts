import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/ast/parse-source';
import { analyzeImplementationOverhead, createEmptyImplementationOverhead } from './analyzer';

const file = (relPath: string, sourceText: string) => parseSource(`/p/${relPath}`, sourceText);

const fileWithErrors = (relPath: string, sourceText: string) => {
  const parsed = file(relPath, sourceText);

  return { ...parsed, errors: [{ message: 'synthetic' }] as any };
};

describe('implementation-overhead/analyzer', () => {
  it('should return empty result when files are empty', () => {
    // Arrange
    const files: any[] = [];
    // Act
    const result = analyzeImplementationOverhead(files as any, { minRatio: 1 });

    // Assert
    expect(result).toEqual(createEmptyImplementationOverhead());
  });

  it('should ignore files with parse errors', () => {
    // Arrange
    const files = [fileWithErrors('src/a.ts', 'export function f( {'), file('src/b.ts', 'export const b = 1;')];
    // Act
    const result = analyzeImplementationOverhead(files as any, { minRatio: 0 });

    // Assert
    expect(result.length).toBe(0);
  });

  it('should ignore non-ts files', () => {
    // Arrange
    const files = [file('src/a.js', 'export function f() { if (a) return 1; return 0; }')];
    // Act
    const result = analyzeImplementationOverhead(files as any, { minRatio: 0 });

    // Assert
    expect(result.length).toBe(0);
  });

  it('should report exported functions when implementation complexity dominates interface complexity', () => {
    // Arrange
    const sourceText = [
      'export function f() {',
      '  let x = 0;',
      '  x++;',
      '  x++;',
      '  if (x > 0) { x++; }',
      '  for (let i = 0; i < 2; i++) { x++; }',
      '  return x;',
      '}',
    ].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeImplementationOverhead(files as any, { minRatio: 1 });

    // Assert
    expect(result.length).toBe(1);
    expect(result[0]?.kind).toBe('implementation-overhead');
    expect(result[0]?.ratio).toBeGreaterThan(1);
  });

  it('should not report when minRatio is too high', () => {
    // Arrange
    const sourceText = 'export function f(a: number) { return a + 1; }';
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeImplementationOverhead(files as any, { minRatio: 999 });

    // Assert
    expect(result.length).toBe(0);
  });

  it('should report arrow exported functions via the arrow handler', () => {
    // Arrange
    const sourceText = [
      'export const f = (a: number) => {',
      '  let x = a;',
      '  if (x > 0) { x++; }',
      '  if (x > 1) { x++; }',
      '  if (x > 2) { x++; }',
      '  return x;',
      '};',
    ].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeImplementationOverhead(files as any, { minRatio: 1 });

    // Assert
    expect(result.length).toBe(1);
  });

  it('should not double-count for-header semicolons', () => {
    // Arrange — for(let i=0; i<n; i++) has 2 header semicolons + 1 for keyword
    // Without fix: semicolons=2+fors=1 → 3. With fix: adjustedSemicolons=0+fors=1 → 1
    const sourceText = [
      'export function g(n: number) {',
      '  for (let i = 0; i < n; i++) {',
      '    console.log(i);',
      '  }',
      '}',
    ].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act — use a high minRatio. Old (bugged) complexity = 3+, new (fixed) = lower
    const result = analyzeImplementationOverhead(files as any, { minRatio: 3 });

    // Assert — with the fix, ratio should be lower and NOT reported at minRatio=3
    expect(result.length).toBe(0);
  });

  it('should not over-subtract semicolons for for-of and for-in loops', () => {
    // Arrange — for-of/for-in have 0 header semicolons; should NOT subtract 2 per loop
    // `for (const x of items) { arr.push(x); }` — 1 semicolon (push), 0 ifs, 1 for
    // Correct complexity: semicolons=1, c-style fors=0, adjusted=1, + fors=1 → 2
    // Over-subtract bug: semicolons=1, fors=1, adjusted=max(0,1-2)=0, + fors=1 → 1
    const sourceText = [
      'export function collect(items: string[]): string[] {',
      '  const arr: string[] = [];',
      '  for (const x of items) { arr.push(x); }',
      '  for (const k in items) { arr.push(k); }',
      '  return arr;',
      '}',
    ].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act — minRatio=1 so it reports if complexity >= interface complexity
    const result = analyzeImplementationOverhead(files as any, { minRatio: 1 });

    // Assert — should report (complexity ≥ 1). The key check:
    // Without fix: adjustedSemicolons = max(0, 3 - 2*2) = 0, total = 0+2 = 2
    // With fix: adjustedSemicolons = max(0, 3 - 0*2) = 3, total = 3+2 = 5
    // Either way it reports, but the ratio should reflect the correct (higher) complexity
    expect(result.length).toBe(1);
    // Implementation complexity should be >= 5 (3 semicolons + 2 for loops, 0 c-style adjustment)
    expect(result[0]?.implementationComplexity).toBeGreaterThanOrEqual(5);
  });
});
