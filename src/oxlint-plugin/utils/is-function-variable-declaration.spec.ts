import { describe, expect, it } from 'bun:test';

import type { AstNode } from '../types.js';

import { isFunctionVariableDeclaration } from './is-function-variable-declaration.js';

const VariableDeclarationType = 'VariableDeclaration';
const VariableDeclaratorType = 'VariableDeclarator';
const ArrowFunctionExpressionType = 'ArrowFunctionExpression';
const FunctionExpressionType = 'FunctionExpression';
const IdentifierType = 'Identifier';
const ExpressionStatementType = 'ExpressionStatement';

const createVariableDeclarator = (initType?: string): AstNode => {
  if (initType === undefined) {
    return { type: VariableDeclaratorType };
  }

  return {
    type: VariableDeclaratorType,
    init: { type: initType },
  };
};

const createVariableDeclaration = (declarations: AstNode[]): AstNode => {
  return {
    type: VariableDeclarationType,
    declarations,
  };
};

describe('is-function-variable-declaration', () => {
  it('should return true when all declarators are function initializers', () => {
    // Arrange
    const node = createVariableDeclaration([
      createVariableDeclarator(ArrowFunctionExpressionType),
      createVariableDeclarator(FunctionExpressionType),
    ]);
    // Act
    const result = isFunctionVariableDeclaration(node);

    // Assert
    expect(result).toBe(true);
  });

  it('should return true when all initializers are arrow functions', () => {
    // Arrange
    const node = createVariableDeclaration([
      createVariableDeclarator(ArrowFunctionExpressionType),
      createVariableDeclarator(ArrowFunctionExpressionType),
    ]);
    // Act
    const result = isFunctionVariableDeclaration(node);

    // Assert
    expect(result).toBe(true);
  });

  it('should return false when any initializer is not a function', () => {
    // Arrange
    const node = createVariableDeclaration([createVariableDeclarator(IdentifierType)]);
    // Act
    const result = isFunctionVariableDeclaration(node);

    // Assert
    expect(result).toBe(false);
  });

  it('should return false when any declarator has no initializer', () => {
    // Arrange
    const node = createVariableDeclaration([createVariableDeclarator(ArrowFunctionExpressionType), createVariableDeclarator()]);
    // Act
    const result = isFunctionVariableDeclaration(node);

    // Assert
    expect(result).toBe(false);
  });

  it('should return false when declarations are empty', () => {
    // Arrange
    const node = createVariableDeclaration([]);
    // Act
    const result = isFunctionVariableDeclaration(node);

    // Assert
    expect(result).toBe(false);
  });

  it('should return false when node is not a VariableDeclaration', () => {
    // Arrange
    const node: AstNode = { type: ExpressionStatementType };
    // Act
    const result = isFunctionVariableDeclaration(node);

    // Assert
    expect(result).toBe(false);
  });

  it('should return false when node is null', () => {
    // Arrange
    const node = null;
    // Act
    const result = isFunctionVariableDeclaration(node);

    // Assert
    expect(result).toBe(false);
  });

  it('should return false when node is undefined', () => {
    // Act
    const result = isFunctionVariableDeclaration(undefined);

    // Assert
    expect(result).toBe(false);
  });
});
