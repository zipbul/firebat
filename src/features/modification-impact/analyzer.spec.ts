import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/ast/parse-source';
import { analyzeModificationImpact, createEmptyModificationImpact } from './analyzer';

const file = (relPath: string, sourceText: string) => parseSource(`/p/${relPath}`, sourceText);

const fileWithErrors = (relPath: string, sourceText: string) => {
  const parsed = file(relPath, sourceText);

  return { ...parsed, errors: [{ message: 'synthetic' }] as any };
};

describe('modification-impact/analyzer', () => {
  it('should return empty result when files are empty', () => {
    // Arrange
    const files: any[] = [];
    // Act
    const result = analyzeModificationImpact(files as any);

    // Assert
    expect(result).toEqual(createEmptyModificationImpact());
  });

  it('should ignore files with parse errors', () => {
    // Arrange
    const files = [fileWithErrors('src/a.ts', 'export function f() { return 1; }'), file('src/b.ts', 'export const b = 1;')];
    // Act
    const result = analyzeModificationImpact(files as any);

    // Assert
    expect(result.length).toBe(0);
  });

  it('should report exported symbols with impact radius >= 2', () => {
    // Arrange
    const files = [
      file('src/a.ts', 'export function f() { return 1; }'),
      file('src/b.ts', 'import { f } from "./a"; export const b = () => f();'),
      file('src/c.ts', 'import { f } from "./a"; export const c = () => f();'),
    ];
    // Act
    const result = analyzeModificationImpact(files as any);

    // Assert
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]?.kind).toBe('modification-impact');
    expect(typeof result[0]?.impactRadius).toBe('number');
    expect(result[0]?.impactRadius).toBeGreaterThanOrEqual(2);
  });

  it('should not report when impact radius is below threshold', () => {
    // Arrange
    const files = [
      file('src/a.ts', 'export function f() { return 1; }'),
      file('src/b.ts', 'import { f } from "./a"; export const b = () => f();'),
    ];
    // Act
    const result = analyzeModificationImpact(files as any);

    // Assert
    expect(result.length).toBe(0);
  });

  it('should populate highRiskCallers when application exports are used from adapters/infrastructure', () => {
    // Arrange
    const files = [
      file('src/application/service.ts', 'export function f() { return 1; }'),
      file('src/adapters/cli/entry.ts', 'import { f } from "../../application/service"; export const run = () => f();'),
      file('src/infrastructure/db.ts', 'import { f } from "../application/service"; export const db = () => f();'),
    ];
    // Act
    const result = analyzeModificationImpact(files as any);

    // Assert
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(result[0]?.highRiskCallers)).toBe(true);
    expect((result[0]?.highRiskCallers ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
