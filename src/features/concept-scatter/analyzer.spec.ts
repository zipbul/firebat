import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/ast/parse-source';
import { analyzeConceptScatter, createEmptyConceptScatter } from './analyzer';

const file = (relPath: string, sourceText: string) => parseSource(`/p/${relPath}`, sourceText);

const fileWithErrors = (relPath: string, sourceText: string) => {
  const parsed = file(relPath, sourceText);

  return { ...parsed, errors: [{ message: 'synthetic' }] as any };
};

describe('concept-scatter/analyzer', () => {
  it('should return empty result when files are empty', () => {
    // Arrange
    const files: any[] = [];
    // Act
    const result = analyzeConceptScatter(files as any, { maxScatterIndex: 3 });

    // Assert
    expect(result).toEqual(createEmptyConceptScatter());
  });

  it('should ignore files with parse errors', () => {
    // Arrange
    const files = [fileWithErrors('src/a.ts', 'export const x =')];
    // Act
    const result = analyzeConceptScatter(files as any, { maxScatterIndex: 0 });

    // Assert
    expect(result.length).toBe(0);
  });

  it('should ignore non-ts files', () => {
    // Arrange
    const files = [file('src/a.js', 'export const paymentUser = 1;')];
    // Act
    const result = analyzeConceptScatter(files as any, { maxScatterIndex: 0 });

    // Assert
    expect(result.length).toBe(0);
  });

  it('should report when a concept is scattered across multiple files and layers', () => {
    // Arrange
    const files = [
      file('src/application/payment/service.ts', 'export const paymentService = 1;'),
      file('src/adapters/cli/payment/entry.ts', 'export const paymentCli = 1;'),
      file('src/infrastructure/payment/repo.ts', 'export const paymentRepo = 1;'),
      file('src/ports/payment.port.ts', 'export interface PaymentPort {}'),
    ];
    // Act
    const result = analyzeConceptScatter(files as any, { maxScatterIndex: 3 });

    // Assert
    expect(result.length).toBeGreaterThanOrEqual(1);

    const payment = result.find(r => r.concept === 'payment');

    expect(payment).toBeDefined();
    expect((payment?.files ?? []).length).toBeGreaterThanOrEqual(3);
    expect((payment?.layers ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('should not report when maxScatterIndex is high enough', () => {
    // Arrange
    const files = [
      file('src/application/payment/service.ts', 'export const paymentService = 1;'),
      file('src/adapters/cli/payment/entry.ts', 'export const paymentCli = 1;'),
      file('src/infrastructure/payment/repo.ts', 'export const paymentRepo = 1;'),
      file('src/ports/payment.port.ts', 'export interface PaymentPort {}'),
    ];
    // Act
    const result = analyzeConceptScatter(files as any, { maxScatterIndex: 999 });

    // Assert
    expect(result.length).toBe(0);
  });

  it('should clamp negative maxScatterIndex to 0', () => {
    // Arrange
    const files = [file('src/a.ts', 'export const userPayment = 1;'), file('src/b.ts', 'export const userPayment2 = 2;')];
    // Act
    const result = analyzeConceptScatter(files as any, { maxScatterIndex: -1 });

    // Assert
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});
