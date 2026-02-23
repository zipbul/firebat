import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/ast/parse-source';
import { analyzeVariableLifetime, createEmptyVariableLifetime } from './analyzer';

const file = (relPath: string, sourceText: string) => parseSource(`/p/${relPath}`, sourceText);

const fileWithErrors = (relPath: string, sourceText: string) => {
  const parsed = file(relPath, sourceText);

  return { ...parsed, errors: [{ message: 'synthetic' }] as any };
};

describe('variable-lifetime/analyzer', () => {
  it('should return empty result when files are empty', () => {
    // Arrange
    const files: any[] = [];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 3 });

    // Assert
    expect(result).toEqual(createEmptyVariableLifetime());
  });

  it('should ignore files with parse errors', () => {
    // Arrange
    const files = [fileWithErrors('src/a.ts', 'const a = 1;\nexport const x = a;')];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 1 });

    // Assert
    expect(result.length).toBe(0);
  });

  it('should ignore non-ts files', () => {
    // Arrange
    const files = [file('src/a.js', 'const a = 1;\nexport const x = a;')];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 1 });

    // Assert
    expect(result.length).toBe(0);
  });

  it('should report variables whose lifetime exceeds maxLifetimeLines', () => {
    // Arrange
    const sourceText = [
      'const x = 1;',
      'export const a = 1;',
      'export const b = 2;',
      'export const c = 3;',
      'export const d = 4;',
      'export const e = 5;',
      'export const y = x;',
    ].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 2 });

    // Assert
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]?.kind).toBe('variable-lifetime');
    expect(result[0]?.lifetimeLines).toBeGreaterThan(2);
  });

  it('should not report when lifetime is within maxLifetimeLines', () => {
    // Arrange
    const sourceText = ['const x = 1;', 'export const y = x;'].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 10 });

    // Assert
    expect(result.length).toBe(0);
  });

  it('should clamp negative maxLifetimeLines to 0', () => {
    // Arrange
    const sourceText = ['const x = 1;', 'export const a = 1;', 'export const y = x;'].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: -1 });

    // Assert
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});
