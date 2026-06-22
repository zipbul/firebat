import { describe, expect, it } from 'bun:test';

import type { AstNode } from '../types';

import { setupRule, expectReportCount } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { noUnmodifiedLoopConditionRule } from './no-unmodified-loop-condition';

const emptyBody: AstNode = { type: 'BlockStatement', body: [] };

describe('no-unmodified-loop-condition', () => {
  it.each<[string, AstNode]>([
    ['loop condition identifiers are never mutated', { type: 'Identifier', name: 'flag' }],
    [
      'object member in condition is unmodified',
      // while (list.length > 0) {} <-- if list is not mutated
      {
        type: 'BinaryExpression',
        left: {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'list' },
          property: { type: 'Identifier', name: 'length' },
        },
      },
    ],
  ])('should report when %s', (_label, testNode) => {
    // Arrange
    const { visitor, reports } = setupRule(noUnmodifiedLoopConditionRule);
    const whileNode: AstNode = { type: 'WhileStatement', test: testNode, body: emptyBody };

    // Act
    expectReportCount(visitor, 'WhileStatement', whileNode, reports, 1);
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
    expectReportCount(visitor, 'WhileStatement', whileNode, reports, 0);
  });

  it('should skip report when ForStatement update clause mutates', () => {
    // Arrange
    const { visitor, reports } = setupRule(noUnmodifiedLoopConditionRule);
    // for (; i < 10; i++)
    const testNode: AstNode = { type: 'BinaryExpression', left: { type: 'Identifier', name: 'i' } };
    const updateNode: AstNode = { type: 'UpdateExpression', argument: { type: 'Identifier', name: 'i' } };
    const forNode: AstNode = { type: 'ForStatement', test: testNode, update: updateNode, body: emptyBody };

    // Act
    expectReportCount(visitor, 'ForStatement', forNode, reports, 0);
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
    expectReportCount(visitor, 'DoWhileStatement', doWhileNode, reports, 0);
  });
});
