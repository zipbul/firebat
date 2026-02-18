import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/parse-source';
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
});
