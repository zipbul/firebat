import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/parse-source';
import { analyzeInvariantBlindspot, createEmptyInvariantBlindspot } from './analyzer';

const file = (relPath: string, sourceText: string) => parseSource(`/p/${relPath}`, sourceText);

const fileWithErrors = (relPath: string, sourceText: string) => {
  const parsed = file(relPath, sourceText);

  return { ...parsed, errors: [{ message: 'synthetic' }] as any };
};

describe('invariant-blindspot/analyzer', () => {
  it('should return empty result when files are empty', () => {
    // Arrange
    const files: any[] = [];
    // Act
    const result = analyzeInvariantBlindspot(files as any);

    // Assert
    expect(result).toEqual(createEmptyInvariantBlindspot());
  });

  it('should ignore files with parse errors', () => {
    // Arrange
    const files = [fileWithErrors('src/a.ts', 'console.assert(true)'), file('src/b.ts', 'export const b = 1;')];
    // Act
    const result = analyzeInvariantBlindspot(files as any);

    // Assert
    expect(result.length).toBe(0);
  });

  it('should ignore non-ts files', () => {
    // Arrange
    const files = [file('src/a.js', 'console.assert(true)')];
    // Act
    const result = analyzeInvariantBlindspot(files as any);

    // Assert
    expect(result.length).toBe(0);
  });

  it('should report when console.assert is present', () => {
    // Arrange
    const files = [file('src/a.ts', 'export function f(xs: number[]) { console.assert(xs.length > 0); return xs[0]; }')];
    // Act
    const result = analyzeInvariantBlindspot(files as any);

    // Assert
    expect(result.length).toBe(1);
    expect(result[0]?.kind).toBe('invariant-blindspot');
  });

  it('should report when throw new Error() is present', () => {
    // Arrange
    const files = [
      file('src/a.ts', 'export function f(x: number | null) { if (x === null) throw new Error("x"); return x + 1; }'),
    ];
    // Act
    const result = analyzeInvariantBlindspot(files as any);

    // Assert
    expect(result.length).toBe(1);
  });

  it('should report when must/always/never/before appears in comments', () => {
    // Arrange
    const files = [file('src/a.ts', '// must call init() before query()\nexport const x = 1;')];
    // Act
    const result = analyzeInvariantBlindspot(files as any);

    // Assert
    expect(result.length).toBe(1);
  });

  it('should report when default branch throws', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'export function f(s: "A" | "B") {',
          '  switch (s) {',
          '    case "A": return 1;',
          '    case "B": return 2;',
          '    default: throw new Error("x");',
          '  }',
          '}',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeInvariantBlindspot(files as any);

    // Assert
    expect(result.length).toBe(1);
  });

  it('should report when an array bounds check throws', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        ['export function f(xs: string[]) {', '  if (xs.length === 0) throw new Error("empty");', '  return xs[0];', '}'].join(
          '\n',
        ),
      ),
    ];
    // Act
    const result = analyzeInvariantBlindspot(files as any);

    // Assert
    expect(result.length).toBe(1);
  });

  it('should not report when no invariant signals exist', () => {
    // Arrange
    const files = [file('src/a.ts', 'export const add = (a: number, b: number) => a + b;')];
    // Act
    const result = analyzeInvariantBlindspot(files as any);

    // Assert
    expect(result.length).toBe(0);
  });

  it('should not report when comment contains only casual before keyword', () => {
    // Arrange — "before" is too generic, should not trigger on its own
    const files = [file('src/a.ts', '// process items before returning\nexport const x = 1;')];
    // Act
    const result = analyzeInvariantBlindspot(files as any);

    // Assert
    expect(result.length).toBe(0);
  });
});
