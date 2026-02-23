import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/ast/parse-source';
import { analyzeSymmetryBreaking, createEmptySymmetryBreaking } from './analyzer';

const file = (relPath: string, sourceText: string) => parseSource(`/p/${relPath}`, sourceText);

const fileWithErrors = (relPath: string, sourceText: string) => {
  const parsed = file(relPath, sourceText);

  return { ...parsed, errors: [{ message: 'synthetic' }] as any };
};

describe('symmetry-breaking/analyzer', () => {
  it('should return empty result when files are empty', () => {
    // Arrange
    const files: any[] = [];
    // Act
    const result = analyzeSymmetryBreaking(files as any);

    // Assert
    expect(result).toEqual(createEmptySymmetryBreaking());
  });

  it('should ignore files with parse errors', () => {
    // Arrange
    const files = [
      fileWithErrors('src/a.ts', 'export function aHandler() { one(); }'),
      file('src/b.ts', 'export function bHandler() { one(); }'),
    ];
    // Act
    const result = analyzeSymmetryBreaking(files as any);

    // Assert
    expect(result.length).toBe(0);
  });

  it('should report only outliers when a group has a clear majority call sequence', () => {
    // Arrange
    const majority =
      'export function aHandler() { validate(); authorize(); execute(); respond(); }\nconst validate=()=>0; const authorize=()=>0; const execute=()=>0; const respond=()=>0;';
    const outlier =
      'export function outHandler() { authorize(); validate(); execute(); retryOnFailure(); respond(); }\nconst validate=()=>0; const authorize=()=>0; const execute=()=>0; const retryOnFailure=()=>0; const respond=()=>0;';
    const files = [
      file('src/h1.ts', majority),
      file('src/h2.ts', majority),
      file('src/h3.ts', majority),
      file('src/out.ts', outlier),
    ];
    // Act
    const result = analyzeSymmetryBreaking(files as any);

    // Assert
    expect(result.length).toBe(1);
    expect(result[0]?.file.endsWith('.ts')).toBe(true);
    expect(result[0]?.kind).toBe('symmetry-breaking');
  });

  it('should not report when all items in a group share the same call sequence', () => {
    // Arrange
    const same = 'export function aHandler() { validate(); authorize(); }\nconst validate=()=>0; const authorize=()=>0;';
    const files = [file('src/a.ts', same), file('src/b.ts', same), file('src/c.ts', same)];
    // Act
    const result = analyzeSymmetryBreaking(files as any);

    // Assert
    expect(result.length).toBe(0);
  });

  it('should fall back to return-structure deviation when call sequences do not produce findings', () => {
    // Arrange
    const files = [
      file('src/controllers/a.ts', 'export function aController() { return 1; }'),
      file('src/controllers/b.ts', 'export function bController() { return 1; }'),
      file('src/controllers/c.ts', 'export function cController() { return 1; }'),
      file('src/controllers/out.ts', 'export function outController() { return 2; }'),
    ];
    // Act
    const result = analyzeSymmetryBreaking(files as any);

    // Assert
    expect(result.length).toBe(1);
    expect(result[0]?.file).toContain('controllers');
  });
});
