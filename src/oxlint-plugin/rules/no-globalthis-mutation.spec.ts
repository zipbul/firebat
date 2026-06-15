import { describe, expect, it } from 'bun:test';

import type { AstNode } from '../types';

import { setupRule } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { noGlobalThisMutationRule } from './no-globalthis-mutation';

describe('no-globalthis-mutation', () => {
  it('should report assignments when globalThis members are mutated', () => {
    // Arrange
    const { visitor, reports } = setupRule(noGlobalThisMutationRule);
    const leftNode: AstNode = {
      type: 'MemberExpression',
      object: { type: 'Identifier', name: 'globalThis' },
      property: { type: 'Identifier', name: 'value' },
    };
    const assignmentNode: AstNode = { type: 'AssignmentExpression', left: leftNode };

    // Act
    visitor.AssignmentExpression(assignmentNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('globalThisMutation');
  });

  it('should report update expressions when targeting globalThis members', () => {
    // Arrange
    const { visitor, reports } = setupRule(noGlobalThisMutationRule);
    const argumentNode: AstNode = {
      type: 'MemberExpression',
      object: { type: 'Identifier', name: 'globalThis' },
      property: { type: 'Identifier', name: 'count' },
    };
    const updateNode: AstNode = { type: 'UpdateExpression', argument: argumentNode };

    // Act
    visitor.UpdateExpression(updateNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('globalThisMutation');
  });

  it('should report Object.assign when targeting globalThis', () => {
    // Arrange
    const { visitor, reports } = setupRule(noGlobalThisMutationRule);
    const callNode: AstNode = {
      type: 'CallExpression',
      callee: {
        type: 'MemberExpression',
        object: { type: 'Identifier', name: 'Object' },
        property: { type: 'Identifier', name: 'assign' },
        computed: false,
      },
      arguments: [{ type: 'Identifier', name: 'globalThis' }],
    };

    // Act
    visitor.CallExpression(callNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('globalThisMutation');
  });

  it('should report Object.defineProperty when targeting globalThis', () => {
    // Arrange
    const { visitor, reports } = setupRule(noGlobalThisMutationRule);
    const callNode: AstNode = {
      type: 'CallExpression',
      callee: {
        type: 'MemberExpression',
        object: { type: 'Identifier', name: 'Object' },
        property: { type: 'Identifier', name: 'defineProperty' },
        computed: false,
      },
      arguments: [{ type: 'Identifier', name: 'globalThis' }],
    };

    // Act
    visitor.CallExpression(callNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('globalThisMutation');
  });

  it('should report delete usage when targeting globalThis member', () => {
    // Arrange
    const { visitor, reports } = setupRule(noGlobalThisMutationRule);
    const deleteNode: AstNode = {
      type: 'UnaryExpression',
      operator: 'delete',
      argument: {
        type: 'MemberExpression',
        object: { type: 'Identifier', name: 'globalThis' },
        property: { type: 'Identifier', name: 'prop' },
      },
    };

    // Act
    visitor.UnaryExpression(deleteNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('globalThisMutation');
  });

  it('should report when nested globalThis assignments occur', () => {
    // Arrange
    const { visitor, reports } = setupRule(noGlobalThisMutationRule);
    // globalThis.prop.sub = 1
    // Left side is MemberExpression(object=MemberExpression(globalThis.prop), property=sub)
    const leftNode: AstNode = {
      type: 'MemberExpression',
      object: {
        type: 'MemberExpression',
        object: { type: 'Identifier', name: 'globalThis' },
        property: { type: 'Identifier', name: 'prop' },
      },
      property: { type: 'Identifier', name: 'sub' },
    };
    const assignmentNode: AstNode = { type: 'AssignmentExpression', left: leftNode };

    // Act
    visitor.AssignmentExpression(assignmentNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('globalThisMutation');
  });
});
