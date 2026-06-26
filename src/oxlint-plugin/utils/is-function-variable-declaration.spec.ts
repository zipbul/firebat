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
  // Each row: the input node and the expected isFunctionVariableDeclaration verdict.
  it.each<[string, AstNode | null | undefined, boolean]>([
    [
      'all declarators are function initializers',
      createVariableDeclaration([
        createVariableDeclarator(ArrowFunctionExpressionType),
        createVariableDeclarator(FunctionExpressionType),
      ]),
      true,
    ],
    [
      'all initializers are arrow functions',
      createVariableDeclaration([
        createVariableDeclarator(ArrowFunctionExpressionType),
        createVariableDeclarator(ArrowFunctionExpressionType),
      ]),
      true,
    ],
    ['any initializer is not a function', createVariableDeclaration([createVariableDeclarator(IdentifierType)]), false],
    [
      'any declarator has no initializer',
      createVariableDeclaration([createVariableDeclarator(ArrowFunctionExpressionType), createVariableDeclarator()]),
      false,
    ],
    ['declarations are empty', createVariableDeclaration([]), false],
    ['node is not a VariableDeclaration', { type: ExpressionStatementType }, false],
    ['node is null', null, false],
    ['node is undefined', undefined, false],
  ])('should return the verdict when %s', (_label, node, expected) => {
    expect(isFunctionVariableDeclaration(node)).toBe(expected);
  });
});
