import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/parse-source';
import { analyzeTemporalCoupling, createEmptyTemporalCoupling } from './analyzer';

const file = (relPath: string, sourceText: string) => parseSource(`/p/${relPath}`, sourceText);

const fileWithErrors = (relPath: string, sourceText: string) => {
  const parsed = file(relPath, sourceText);

  return { ...parsed, errors: [{ message: 'synthetic' }] as any };
};

describe('temporal-coupling/analyzer', () => {
  it('should return empty result when files are empty', () => {
    // Arrange
    const files: any[] = [];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert
    expect(result).toEqual(createEmptyTemporalCoupling());
  });

  it('should ignore files with parse errors', () => {
    // Arrange
    const files = [
      fileWithErrors('src/a.ts', 'let db: number | null = null; export function init() { db = 1; }'),
      file('src/b.ts', 'export const x = 1;'),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert
    expect(result.length).toBe(0);
  });

  it('should ignore non-ts files', () => {
    // Arrange
    const files = [file('src/a.js', 'let db = null; export function init() { db = 1; } export function query() { return db; }')];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert
    expect(result.length).toBe(0);
  });

  it('should report temporal coupling when a module-scope variable is written and read by different exported functions', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'let db: number | null = null;',
          'export function initDb() { db = 1; }',
          'export function queryUsers() { return db; }',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]?.kind).toBe('temporal-coupling');
  });

  it('should emit one finding per reader when one writer feeds multiple readers', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'let conn: object | null = null;',
          'export function connect() { conn = {}; }',
          'export function q1() { return conn; }',
          'export function q2() { return conn; }',
          'export function q3() { return conn; }',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it('should not report when there are no readers', () => {
    // Arrange
    const files = [
      file('src/a.ts', ['let x = 0;', 'export function set() { x = 1; }', 'export function a() { return 1; }'].join('\n')),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert
    expect(result.length).toBe(0);
  });

  it('should report temporal coupling for class init/query guard patterns', () => {
    // Arrange
    const files = [
      file(
        'src/a.ts',
        [
          'export class Service {',
          '  private initialized = false;',
          '  init() { this.initialized = true; }',
          '  query() { if (!this.initialized) throw new Error("not ready"); return 1; }',
          '}',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeTemporalCoupling(files as any);

    // Assert
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});
