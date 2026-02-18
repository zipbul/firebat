import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/parse-source';
import { analyzeModificationTrap, createEmptyModificationTrap } from './analyzer';

const file = (relPath: string, sourceText: string) => parseSource(`/p/${relPath}`, sourceText);

const fileWithErrors = (relPath: string, sourceText: string) => {
  const parsed = file(relPath, sourceText);

  return { ...parsed, errors: [{ message: 'synthetic' }] as any };
};

describe('modification-trap/analyzer', () => {
  it('should return empty result when files are empty', () => {
    // Arrange
    const files: any[] = [];
    // Act
    const result = analyzeModificationTrap(files as any);

    // Assert
    expect(result).toEqual(createEmptyModificationTrap());
  });

  it('should ignore files with parse errors', () => {
    // Arrange
    const files = [
      fileWithErrors('src/a.ts', 'export function f() { switch (x) { case "A": return 1; } }'),
      file('src/b.ts', 'export const b = 1;'),
    ];
    // Act
    const result = analyzeModificationTrap(files as any);

    // Assert
    expect(result.length).toBe(0);
  });

  it('should report when two files share the same switch-case label set', () => {
    // Arrange
    const a = 'export function f(s: string) { switch (s) { case "A": return 1; case "B": return 2; default: return 0; } }';
    const b = 'export function g(s: string) { switch (s) { case "B": return 1; case "A": return 2; default: return 0; } }';
    const files = [file('src/a.ts', a), file('src/b.ts', b)];
    // Act
    const result = analyzeModificationTrap(files as any);

    // Assert
    expect(result.length).toBe(2);
    expect(result[0]?.kind).toBe('modification-trap');
  });

  it('should report when two files share the same literal comparison label set', () => {
    // Arrange
    const a = 'export const f = (s: string) => (s === "A" ? 1 : 0);';
    const b = 'export const g = (s: string) => (s === "A" ? 2 : 0);';
    const files = [file('src/a.ts', a), file('src/b.ts', b)];
    // Act
    const result = analyzeModificationTrap(files as any);

    // Assert
    expect(result.length).toBe(2);
  });

  it('should report when repeated imports of a shared type appear across multiple files', () => {
    // Arrange
    const a = 'import type { User } from "./types"; export const a = (u: User) => u.id;';
    const b = 'import type { User } from "./types"; export const b = (u: User) => u.name;';
    const files = [
      file('src/a.ts', a),
      file('src/b.ts', b),
      file('src/types.ts', 'export interface User { id: string; name: string }'),
    ];
    // Act
    const result = analyzeModificationTrap(files as any);

    // Assert
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('should not report when a pattern exists in only one file', () => {
    // Arrange
    const files = [file('src/a.ts', 'export function f(s: string) { switch (s) { case "A": return 1; default: return 0; } }')];
    // Act
    const result = analyzeModificationTrap(files as any);

    // Assert
    expect(result.length).toBe(0);
  });
});
