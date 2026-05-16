import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/ast/parse-source';
import { analyzeGiantFile, createEmptyGiantFile } from './analyzer';

const file = (relPath: string, sourceText: string) => parseSource(`/p/${relPath}`, sourceText);

const fileWithErrors = (relPath: string, sourceText: string) => {
  const parsed = file(relPath, sourceText);

  return { ...parsed, errors: [{ message: 'synthetic' }] as any };
};

describe('giant-file/analyzer', () => {
  it('should return empty result when files are empty', () => {
    // Arrange
    const files: any[] = [];
    // Act
    const result = analyzeGiantFile(files as any, { maxLines: 10 });

    // Assert
    expect(result).toEqual(createEmptyGiantFile());
  });

  it('should ignore files with parse errors', () => {
    // Arrange
    const files = [fileWithErrors('src/a.ts', 'export const x =')];
    // Act
    const result = analyzeGiantFile(files as any, { maxLines: 0 });

    // Assert
    expect(result.length).toBe(0);
  });

  it('should report when lineCount exceeds maxLines', () => {
    // Arrange
    const sourceText = ['export const a = 1;', 'export const b = 2;', 'export const c = 3;', 'export const d = 4;'].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeGiantFile(files as any, { maxLines: 3 });

    // Assert
    expect(result.length).toBe(1);
    expect(result[0]?.kind).toBe('giant-file');
    expect(result[0]?.metrics.lineCount).toBeGreaterThan(3);
  });

  it('should not report when lineCount is within maxLines', () => {
    // Arrange
    const sourceText = ['export const a = 1;', 'export const b = 2;'].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeGiantFile(files as any, { maxLines: 3 });

    // Assert
    expect(result.length).toBe(0);
  });

  it('should clamp negative maxLines to 0', () => {
    // Arrange
    const sourceText = 'export const a = 1;';
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeGiantFile(files as any, { maxLines: -1 });

    // Assert
    expect(result.length).toBe(1);
    expect(result[0]?.metrics.maxLines).toBe(0);
  });

  it('should not count trailing LF as an extra line (LF)', () => {
    // Arrange — 3 lines of content + trailing LF (commonly produced by editors)
    const sourceText = 'a\nb\nc\n';
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeGiantFile(files as any, { maxLines: 0 });

    // Assert
    expect(result.length).toBe(1);
    expect(result[0]?.metrics.lineCount).toBe(3);
  });

  it('should not count trailing CRLF as an extra line', () => {
    // Arrange — 3 lines of content + trailing CRLF
    const sourceText = 'a\r\nb\r\nc\r\n';
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeGiantFile(files as any, { maxLines: 0 });

    // Assert
    expect(result.length).toBe(1);
    expect(result[0]?.metrics.lineCount).toBe(3);
  });

  it('should produce identical lineCount whether or not file ends with trailing newline', () => {
    // Arrange
    const withTrailing = 'a\nb\nc\n';
    const withoutTrailing = 'a\nb\nc';
    // Act
    const r1 = analyzeGiantFile([file('src/a.ts', withTrailing)] as any, { maxLines: 0 });
    const r2 = analyzeGiantFile([file('src/b.ts', withoutTrailing)] as any, { maxLines: 0 });

    // Assert
    expect(r1[0]?.metrics.lineCount).toBe(3);
    expect(r2[0]?.metrics.lineCount).toBe(3);
    expect(r1[0]?.metrics.lineCount).toBe(r2[0]?.metrics.lineCount);
  });
});
