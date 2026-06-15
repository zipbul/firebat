import { describe, expect, it } from 'bun:test';

import type { AstNode } from '../types';

import { setupRule } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { noUnmodifiedLoopConditionRule } from './no-unmodified-loop-condition';

describe('no-unmodified-loop-condition', () => {
  it('should report when loop condition identifiers are never mutated', () => {
    // Arrange
    const { visitor, reports } = setupRule(noUnmodifiedLoopConditionRule);
    const testNode: AstNode = { type: 'Identifier', name: 'flag' };
    const bodyNode: AstNode = { type: 'BlockStatement', body: [] };
    const whileNode: AstNode = { type: 'WhileStatement', test: testNode, body: bodyNode };

    // Act
    visitor.WhileStatement(whileNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('unmodified');
  });

  it('should not report when loop condition identifiers are mutated', () => {
    // Arrange
    const { visitor, reports } = setupRule(noUnmodifiedLoopConditionRule);
    const testNode: AstNode = { type: 'Identifier', name: 'flag' };
    const assignmentNode: AstNode = {
      type: 'AssignmentExpression',
      left: { type: 'Identifier', name: 'flag' },
      operator: '=',
      right: { type: 'Literal', value: true },
    };
    const bodyNode: AstNode = { type: 'BlockStatement', body: [{ type: 'ExpressionStatement', expression: assignmentNode }] };
    const whileNode: AstNode = { type: 'WhileStatement', test: testNode, body: bodyNode };

    // Act
    visitor.WhileStatement(whileNode);

    // Assert
    expect(reports.length).toBe(0);
  });

  it('should skip report when ForStatement update clause mutates', () => {
    // Arrange
    const { visitor, reports } = setupRule(noUnmodifiedLoopConditionRule);
    // for (; i < 10; i++)
    const testNode: AstNode = { type: 'BinaryExpression', left: { type: 'Identifier', name: 'i' } };
    const updateNode: AstNode = { type: 'UpdateExpression', argument: { type: 'Identifier', name: 'i' } };
    const bodyNode: AstNode = { type: 'BlockStatement', body: [] };
    const forNode: AstNode = { type: 'ForStatement', test: testNode, update: updateNode, body: bodyNode };

    // Act
    visitor.ForStatement(forNode);

    // Assert
    expect(reports.length).toBe(0);
  });

  it('should report when object member in condition is unmodified', () => {
    // Arrange
    // while (list.length > 0) {}  <-- if list is not mutated
    const { visitor, reports } = setupRule(noUnmodifiedLoopConditionRule);
    const testNode: AstNode = {
      type: 'BinaryExpression',
      left: {
        type: 'MemberExpression',
        object: { type: 'Identifier', name: 'list' },
        property: { type: 'Identifier', name: 'length' },
      },
    };
    const bodyNode: AstNode = { type: 'BlockStatement', body: [] };
    const whileNode: AstNode = { type: 'WhileStatement', test: testNode, body: bodyNode };

    // Act
    visitor.WhileStatement(whileNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('unmodified');
  });

  it('should skip report when DoWhileStatement mutates condition', () => {
    // Arrange
    const { visitor, reports } = setupRule(noUnmodifiedLoopConditionRule);
    const testNode: AstNode = { type: 'Identifier', name: 'flag' };
    const updateNode: AstNode = {
      type: 'UpdateExpression',
      argument: { type: 'Identifier', name: 'flag' },
    };
    const bodyNode: AstNode = { type: 'BlockStatement', body: [{ type: 'ExpressionStatement', expression: updateNode }] };
    const doWhileNode: AstNode = { type: 'DoWhileStatement', test: testNode, body: bodyNode };

    // Act
    visitor.DoWhileStatement(doWhileNode);

    // Assert
    expect(reports.length).toBe(0);
  });
});
