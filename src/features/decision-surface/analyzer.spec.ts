import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/ast/parse-source';
import { analyzeDecisionSurface, createEmptyDecisionSurface } from './analyzer';

const file = (relPath: string, sourceText: string) => parseSource(`/p/${relPath}`, sourceText);

const fileWithErrors = (relPath: string, sourceText: string) => {
  const parsed = file(relPath, sourceText);

  return { ...parsed, errors: [{ message: 'synthetic' }] as any };
};

describe('decision-surface/analyzer', () => {
  it('should return empty result when files are empty', () => {
    // Arrange
    const files: any[] = [];
    // Act
    const result = analyzeDecisionSurface(files as any, { maxAxes: 3 });

    // Assert
    expect(result).toEqual(createEmptyDecisionSurface());
  });

  it('should ignore files with parse errors', () => {
    // Arrange
    const files = [fileWithErrors('src/a.ts', 'if (x) {'), file('src/b.ts', 'export const b = 1;')];
    // Act
    const result = analyzeDecisionSurface(files as any, { maxAxes: 1 });

    // Assert
    expect(result.length).toBe(0);
  });

  it('should ignore non-ts files', () => {
    // Arrange
    const files = [file('src/a.js', 'if (a && b) { return 1; }')];
    // Act
    const result = analyzeDecisionSurface(files as any, { maxAxes: 1 });

    // Assert
    expect(result.length).toBe(0);
  });

  it('should report when axis count reaches maxAxes threshold', () => {
    // Arrange
    const sourceText = [
      'export function f(user: any, order: any, config: any) {',
      '  if (user.vip && order.amount > 1000) return 1;',
      '  if (config.strict && user.role === "admin") return 2;',
      '  return 0;',
      '}',
    ].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeDecisionSurface(files as any, { maxAxes: 3 });

    // Assert
    expect(result.length).toBe(1);
    expect(result[0]?.kind).toBe('decision-surface');
    expect(result[0]?.axes).toBeGreaterThanOrEqual(3);
    expect(result[0]?.combinatorialPaths).toBeGreaterThanOrEqual(8);
  });

  it('should not report when axis count is below maxAxes', () => {
    // Arrange
    const sourceText = ['export function f(user: any) {', '  if (user.vip) return 1;', '  return 0;', '}'].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeDecisionSurface(files as any, { maxAxes: 2 });

    // Assert
    expect(result.length).toBe(0);
  });

  it('should clamp negative maxAxes to 0', () => {
    // Arrange
    const sourceText = ['export function f(user: any) {', '  if (user.vip) return 1;', '  return 0;', '}'].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeDecisionSurface(files as any, { maxAxes: -1 });

    // Assert
    expect(result.length).toBe(1);
    expect(result[0]?.axes).toBeGreaterThanOrEqual(1);
  });

  it('should handle nested parentheses in if conditions', () => {
    // Arrange — if (fn(x) && y) has nested parens; old regex would truncate at first )
    const sourceText = [
      'export function f(a: any, b: any, c: any) {',
      '  if (fn(a) && b.ok && c.ready) return 1;',
      '  return 0;',
      '}',
    ].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeDecisionSurface(files as any, { maxAxes: 2 });

    // Assert — should detect all 3 axes: fn/a, b.ok, c.ready
    expect(result.length).toBe(1);
    expect(result[0]?.axes).toBeGreaterThanOrEqual(3);
  });

  it('should handle deeply nested parentheses', () => {
    // Arrange — if ((a || b) && (c || d)) has nested parens
    const sourceText = [
      'export function f(a: boolean, b: boolean, c: boolean, d: boolean) {',
      '  if ((a || b) && (c || d)) return 1;',
      '  return 0;',
      '}',
    ].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeDecisionSurface(files as any, { maxAxes: 3 });

    // Assert — should detect 4 axes: a, b, c, d
    expect(result.length).toBe(1);
    expect(result[0]?.axes).toBeGreaterThanOrEqual(4);
  });

  it('should not extract conditions from line comments containing if (', () => {
    // Arrange — `// if (x && y && z)` should not be treated as a real if-condition
    const sourceText = [
      'export function f(a: any) {',
      '  // if (x && y && z) return bad;',
      '  if (a.ok) return 1;',
      '  return 0;',
      '}',
    ].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act — with maxAxes=1, only the real `if (a.ok)` should be found (1 axis)
    const result = analyzeDecisionSurface(files as any, { maxAxes: 3 });

    // Assert — if the comment were parsed, 4+ axes would be found → finding reported
    // Since comment should be skipped, axes should be 1 (only a.ok) → no finding
    expect(result.length).toBe(0);
  });

  it('should not let block comment ) affect paren depth tracking', () => {
    // Arrange — `if (/* ) */ x && y && z)` has a `)` inside a block comment
    const sourceText = [
      'export function f(x: any, y: any, z: any) {',
      '  if (/* ) */ x.a && y.b && z.c) return 1;',
      '  return 0;',
      '}',
    ].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeDecisionSurface(files as any, { maxAxes: 3 });

    // Assert — 3 axes (x.a, y.b, z.c) should be extracted correctly
    expect(result.length).toBe(1);
    expect(result[0]?.axes).toBeGreaterThanOrEqual(3);
  });
});
