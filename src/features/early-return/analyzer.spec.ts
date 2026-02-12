import { describe, expect, it } from 'bun:test';

import {
  countStatements,
  endsWithReturnOrThrow,
  isExitStatement,
  isSingleContinueOrBreakBlock,
  isSingleExitBlock,
} from './analyzer';

const node = (type: string, extra: Record<string, unknown> = {}) => ({ type, ...extra });

describe('early-return/analyzer helpers', () => {
  describe('isExitStatement', () => {
    it('should return false when value is not an oxc node', () => {
      // Arrange
      const values = [null, undefined, 1, 'x', true, [node('ReturnStatement')]] as const;

      // Act
      const results = values.map(value => isExitStatement(value as any));

      // Assert
      expect(results).toEqual([false, false, false, false, false, false]);
    });

    it('should return false when node is not return-or-throw', () => {
      // Arrange
      const value = node('ExpressionStatement');

      // Act
      const result = isExitStatement(value as any);

      // Assert
      expect(result).toBe(false);
    });

    it('should return true when node is ReturnStatement', () => {
      // Arrange
      const value = node('ReturnStatement');

      // Act
      const result = isExitStatement(value as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when node is ThrowStatement', () => {
      // Arrange
      const value = node('ThrowStatement');

      // Act
      const result = isExitStatement(value as any);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('isSingleExitBlock', () => {
    it('should return false when value is not an oxc node', () => {
      // Arrange
      const value = null;

      // Act
      const result = isSingleExitBlock(value as any);

      // Assert
      expect(result).toBe(false);
    });

    it('should return true when value is ReturnStatement', () => {
      // Arrange
      const value = node('ReturnStatement');

      // Act
      const result = isSingleExitBlock(value as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when value is ThrowStatement', () => {
      // Arrange
      const value = node('ThrowStatement');

      // Act
      const result = isSingleExitBlock(value as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when value is not a block or exit statement', () => {
      // Arrange
      const value = node('ExpressionStatement');

      // Act
      const result = isSingleExitBlock(value as any);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when block body is not a single exit statement', () => {
      // Arrange
      const emptyBlock = node('BlockStatement', { body: [] });
      const multiBlock = node('BlockStatement', { body: [node('ReturnStatement'), node('ReturnStatement')] });
      const nonExitBlock = node('BlockStatement', { body: [node('ExpressionStatement')] });

      // Act
      const emptyResult = isSingleExitBlock(emptyBlock as any);
      const multiResult = isSingleExitBlock(multiBlock as any);
      const nonExitResult = isSingleExitBlock(nonExitBlock as any);

      // Assert
      expect(emptyResult).toBe(false);
      expect(multiResult).toBe(false);
      expect(nonExitResult).toBe(false);
    });

    it('should return true when block body contains only ReturnStatement', () => {
      // Arrange
      const value = node('BlockStatement', { body: [node('ReturnStatement')] });

      // Act
      const result = isSingleExitBlock(value as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when block body contains only ThrowStatement', () => {
      // Arrange
      const value = node('BlockStatement', { body: [node('ThrowStatement')] });

      // Act
      const result = isSingleExitBlock(value as any);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('isSingleContinueOrBreakBlock', () => {
    it('should return false when value is not an oxc node', () => {
      // Arrange
      const value = undefined;

      // Act
      const result = isSingleContinueOrBreakBlock(value as any);

      // Assert
      expect(result).toBe(false);
    });

    it('should return true when value is ContinueStatement', () => {
      // Arrange
      const value = node('ContinueStatement');

      // Act
      const result = isSingleContinueOrBreakBlock(value as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when value is BreakStatement', () => {
      // Arrange
      const value = node('BreakStatement');

      // Act
      const result = isSingleContinueOrBreakBlock(value as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when block body is not a single continue-or-break statement', () => {
      // Arrange
      const emptyBlock = node('BlockStatement', { body: [] });
      const multiBlock = node('BlockStatement', { body: [node('ContinueStatement'), node('ContinueStatement')] });
      const nonBreakBlock = node('BlockStatement', { body: [node('ExpressionStatement')] });

      // Act
      const emptyResult = isSingleContinueOrBreakBlock(emptyBlock as any);
      const multiResult = isSingleContinueOrBreakBlock(multiBlock as any);
      const nonBreakResult = isSingleContinueOrBreakBlock(nonBreakBlock as any);

      // Assert
      expect(emptyResult).toBe(false);
      expect(multiResult).toBe(false);
      expect(nonBreakResult).toBe(false);
    });

    it('should return true when block body contains only ContinueStatement', () => {
      // Arrange
      const value = node('BlockStatement', { body: [node('ContinueStatement')] });

      // Act
      const result = isSingleContinueOrBreakBlock(value as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when block body contains only BreakStatement', () => {
      // Arrange
      const value = node('BlockStatement', { body: [node('BreakStatement')] });

      // Act
      const result = isSingleContinueOrBreakBlock(value as any);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe('countStatements', () => {
    it('should return 0 when node is not an oxc node', () => {
      // Arrange
      const value = 'not-a-node';

      // Act
      const result = countStatements(value as any);

      // Assert
      expect(result).toBe(0);
    });

    it('should return 1 when node is not a block statement', () => {
      // Arrange
      const value = node('ReturnStatement');

      // Act
      const result = countStatements(value as any);

      // Assert
      expect(result).toBe(1);
    });

    it('should return 0 when block body is missing or not an array', () => {
      // Arrange
      const missingBody = node('BlockStatement');
      const nonArrayBody = node('BlockStatement', { body: node('ReturnStatement') });

      // Act
      const missingResult = countStatements(missingBody as any);
      const nonArrayResult = countStatements(nonArrayBody as any);

      // Assert
      expect(missingResult).toBe(0);
      expect(nonArrayResult).toBe(0);
    });

    it('should return body length when node is a block statement with array body', () => {
      // Arrange
      const value = node('BlockStatement', { body: [node('ExpressionStatement'), node('ReturnStatement')] });

      // Act
      const result = countStatements(value as any);

      // Assert
      expect(result).toBe(2);
    });
  });

  describe('endsWithReturnOrThrow', () => {
    it('should return false when node is not an oxc node', () => {
      // Arrange
      const value = 123;

      // Act
      const result = endsWithReturnOrThrow(value as any);

      // Assert
      expect(result).toBe(false);
    });

    it('should return true when node is ReturnStatement', () => {
      // Arrange
      const value = node('ReturnStatement');

      // Act
      const result = endsWithReturnOrThrow(value as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when node is ThrowStatement', () => {
      // Arrange
      const value = node('ThrowStatement');

      // Act
      const result = endsWithReturnOrThrow(value as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when node is not a block statement or exit statement', () => {
      // Arrange
      const value = node('ExpressionStatement');

      // Act
      const result = endsWithReturnOrThrow(value as any);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when block body is empty or invalid', () => {
      // Arrange
      const empty = node('BlockStatement', { body: [] });
      const missing = node('BlockStatement');
      const invalidLast = node('BlockStatement', { body: [node('ExpressionStatement'), 'not-a-node'] });

      // Act
      const emptyResult = endsWithReturnOrThrow(empty as any);
      const missingResult = endsWithReturnOrThrow(missing as any);
      const invalidLastResult = endsWithReturnOrThrow(invalidLast as any);

      // Assert
      expect(emptyResult).toBe(false);
      expect(missingResult).toBe(false);
      expect(invalidLastResult).toBe(false);
    });

    it('should return true when block ends with ReturnStatement', () => {
      // Arrange
      const value = node('BlockStatement', { body: [node('ExpressionStatement'), node('ReturnStatement')] });

      // Act
      const result = endsWithReturnOrThrow(value as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when block ends with ThrowStatement', () => {
      // Arrange
      const value = node('BlockStatement', { body: [node('ExpressionStatement'), node('ThrowStatement')] });

      // Act
      const result = endsWithReturnOrThrow(value as any);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when block ends with non-exit statement even if earlier exit exists', () => {
      // Arrange
      const value = node('BlockStatement', { body: [node('ReturnStatement'), node('ExpressionStatement')] });

      // Act
      const result = endsWithReturnOrThrow(value as any);

      // Assert
      expect(result).toBe(false);
    });
  });
});
