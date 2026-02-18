import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/parse-source';
import { analyzeImplicitState, createEmptyImplicitState } from './analyzer';

const file = (relPath: string, sourceText: string) => parseSource(`/p/${relPath}`, sourceText);

const fileWithErrors = (relPath: string, sourceText: string) => {
  const parsed = file(relPath, sourceText);

  return { ...parsed, errors: [{ message: 'synthetic' }] as any };
};

describe('implicit-state/analyzer', () => {
  it('should return empty result when files are empty', () => {
    // Arrange
    const files: any[] = [];
    // Act
    const result = analyzeImplicitState(files as any);

    // Assert
    expect(result).toEqual(createEmptyImplicitState());
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  it('should ignore files with parse errors', () => {
    // Arrange
    const files = [fileWithErrors('src/a.ts', 'export const a = process.env.A;'), file('src/b.ts', 'export const b = 1;')];
    // Act
    const result = analyzeImplicitState(files as any);

    // Assert
    expect(result.length).toBe(0);
  });

  it('should ignore non-ts files', () => {
    // Arrange
    const files = [file('src/a.js', 'export const a = process.env.A;'), file('src/b.js', 'export const b = process.env.A;')];
    // Act
    const result = analyzeImplicitState(files as any);

    // Assert
    expect(result.length).toBe(0);
  });

  it('should report when the same process.env key appears across multiple files', () => {
    // Arrange
    const files = [
      file('src/a.ts', 'export const a = process.env.DATABASE_URL;'),
      file('src/b.ts', 'export const b = process.env.DATABASE_URL;'),
    ];
    // Act
    const result = analyzeImplicitState(files as any);

    // Assert
    expect(result.length).toBeGreaterThanOrEqual(2);

    for (const item of result) {
      expect(item.kind).toBe('implicit-state');
      expect(typeof item.file).toBe('string');
      expect(item.file.endsWith('.ts')).toBe(true);
      expect(item.span).toBeDefined();
      expect(item.code).toBeDefined();
    }
  });

  it('should not report when a process.env key appears in only one file', () => {
    // Arrange
    const files = [file('src/a.ts', 'export const a = process.env.DATABASE_URL;'), file('src/b.ts', 'export const b = 1;')];
    // Act
    const result = analyzeImplicitState(files as any);

    // Assert
    expect(result.length).toBe(0);
  });

  it('should report when getInstance() appears across multiple files', () => {
    // Arrange
    const files = [file('src/a.ts', 'export const a = S.getInstance();'), file('src/b.ts', 'export const b = S.getInstance();')];
    // Act
    const result = analyzeImplicitState(files as any);

    // Assert
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('should report when the same event channel literal appears across multiple files', () => {
    // Arrange
    const files = [
      file('src/a.ts', "export const a = emit('user:created');"),
      file('src/b.ts', "export const b = on('user:created');"),
    ];
    // Act
    const result = analyzeImplicitState(files as any);

    // Assert
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('should report module-scope mutable state used across multiple exported functions', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'let cache: Record<string, number> = {};',
          'export function put(k: string, v: number) { cache[k] = v; }',
          'export function get(k: string) { return cache[k]; }',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeImplicitState(files as any);

    // Assert
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});
