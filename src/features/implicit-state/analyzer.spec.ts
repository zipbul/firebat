import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/ast/parse-source';
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

  it('[NE] should not FP when variable name appears only in comments or strings', () => {
    // Arrange — 'data' appears in a comment and a string, but NOT as an actual identifier reference
    const files = [
      file(
        'src/a.ts',
        [
          'let data = 0;',
          '// data is used here as documentation',
          "export function logInfo() { console.log('data cleared'); }",
          'export function reset() { console.log(1); }',
        ].join('\n'),
      ),
    ];
    // Act
    const result = analyzeImplicitState(files as any);

    // Assert — old regex would match 'data' in comment/string → FP. AST should skip it.
    expect(result.length).toBe(0);
  });

  it('should not detect process.env.KEY inside comments', () => {
    // Arrange — process.env.DATABASE_URL appears in comments, not real code
    const files = [
      file('src/a.ts', [
        '// Required: process.env.DATABASE_URL must be set',
        'export const a = 1;',
      ].join('\n')),
      file('src/b.ts', [
        '/* process.env.DATABASE_URL is injected at build time */',
        'export const b = 2;',
      ].join('\n')),
    ];
    // Act
    const result = analyzeImplicitState(files as any);

    // Assert — should NOT report: process.env.DATABASE_URL is only in comments
    const envFindings = result.filter(r => r.protocol?.includes('process.env'));
    expect(envFindings.length).toBe(0);
  });

  it('should not detect getInstance() inside string literals', () => {
    // Arrange — getInstance appears only in strings
    const files = [
      file('src/a.ts', 'export const a = "call getInstance() to get singleton";'),
      file('src/b.ts', "export const b = 'use getInstance() for service';"),
    ];
    // Act
    const result = analyzeImplicitState(files as any);

    // Assert — should NOT report: getInstance is only inside string literals
    const singletonFindings = result.filter(r => r.protocol?.includes('getInstance'));
    expect(singletonFindings.length).toBe(0);
  });

  it('should not detect emit/on channels inside comments', () => {
    // Arrange — emit('user:created') appears only in comments
    const files = [
      file('src/a.ts', "// emit('user:created') is called when user signs up\nexport const a = 1;"),
      file('src/b.ts', "/* on('user:created') handler */ export const b = 2;"),
    ];
    // Act
    const result = analyzeImplicitState(files as any);

    // Assert — should NOT report: channel references are in comments only
    const channelFindings = result.filter(r => r.protocol?.includes('user:created'));
    expect(channelFindings.length).toBe(0);
  });
});
