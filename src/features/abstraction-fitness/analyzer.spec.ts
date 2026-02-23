import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/ast/parse-source';
import { analyzeAbstractionFitness, createEmptyAbstractionFitness } from './analyzer';

const file = (relPath: string, sourceText: string) => parseSource(`/p/${relPath}`, sourceText);

const fileWithErrors = (relPath: string, sourceText: string) => {
  const parsed = file(relPath, sourceText);

  return { ...parsed, errors: [{ message: 'synthetic' }] as any };
};

describe('abstraction-fitness/analyzer', () => {
  it('should return empty result when files are empty', () => {
    // Arrange
    const files: any[] = [];
    // Act
    const result = analyzeAbstractionFitness(files as any, { minFitnessScore: 0 });

    // Assert
    expect(result).toEqual(createEmptyAbstractionFitness());
  });

  it('should ignore files with parse errors', () => {
    // Arrange
    const files = [fileWithErrors('src/a.ts', 'import { x } from'), file('src/b.ts', 'export const b = 1;')];
    // Act
    const result = analyzeAbstractionFitness(files as any, { minFitnessScore: 0 });

    // Assert
    expect(result.length).toBe(0);
  });

  it('should ignore non-ts files', () => {
    // Arrange
    const files = [file('src/a.js', 'import { x } from "./x"; export const a = x;')];
    // Act
    const result = analyzeAbstractionFitness(files as any, { minFitnessScore: 0 });

    // Assert
    expect(result.length).toBe(0);
  });

  it('should report modules with negative fitness below minFitnessScore', () => {
    // Arrange
    const files = [
      file('src/order/a.ts', 'import { p } from "../payment/p"; export const a = () => p();'),
      file('src/order/b.ts', 'import { p } from "../payment/p"; export const b = () => p();'),
      file('src/payment/p.ts', 'export const p = () => 1;'),
    ];
    // Act
    const result = analyzeAbstractionFitness(files as any, { minFitnessScore: 0 });

    // Assert
    expect(result.length).toBe(1);
    expect(result[0]?.kind).toBe('abstraction-fitness');
    expect(result[0]?.fitness).toBeLessThan(0);
    expect(result[0]?.externalCoupling).toBeGreaterThanOrEqual(1);
  });

  it('should not report when minFitnessScore is low enough', () => {
    // Arrange
    const files = [
      file('src/order/a.ts', 'import { p } from "../payment/p"; export const a = () => p();'),
      file('src/order/b.ts', 'import { p } from "../payment/p"; export const b = () => p();'),
      file('src/payment/p.ts', 'export const p = () => 1;'),
    ];
    // Act
    const result = analyzeAbstractionFitness(files as any, { minFitnessScore: -999 });

    // Assert
    expect(result.length).toBe(0);
  });

  it('should group src root files under src folder and stay quiet when there are no imports', () => {
    // Arrange
    const files = [file('src/a.ts', 'export const a = 1;'), file('src/b.ts', 'export const b = 2;')];
    // Act
    const result = analyzeAbstractionFitness(files as any, { minFitnessScore: 0 });

    // Assert
    expect(result.length).toBe(0);
  });
});
