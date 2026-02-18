import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/parse-source';
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
});
