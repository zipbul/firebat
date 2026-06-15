import { describe, expect, it } from 'bun:test';

import type { AstNode } from '../types';

import { setupRule } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { noInlineObjectTypeRule } from './no-inline-object-type';

describe('no-inline-object-type', () => {
  it('should report inline object types when encountered', () => {
    // Arrange
    const { visitor, reports } = setupRule(noInlineObjectTypeRule);
    const node: AstNode = { type: 'TSTypeLiteral' };

    // Act
    visitor.TSTypeLiteral(node);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('inlineObjectType');
  });

  it('should report each inline object when multiple occurrences exist', () => {
    // Arrange
    const { visitor, reports } = setupRule(noInlineObjectTypeRule);
    const firstNode: AstNode = { type: 'TSTypeLiteral' };
    const secondNode: AstNode = { type: 'TSTypeLiteral' };

    // Act
    visitor.TSTypeLiteral(firstNode);
    visitor.TSTypeLiteral(secondNode);

    // Assert
    expect(reports.length).toBe(2);
    expect(reports[0]?.messageId).toBe('inlineObjectType');
    expect(reports[1]?.messageId).toBe('inlineObjectType');
  });

  it('should allow empty object type when allowEmpty is true', () => {
    // Arrange
    const { visitor, reports } = setupRule(noInlineObjectTypeRule, { options: [{ allowEmpty: true }] });
    const node: AstNode = { type: 'TSTypeLiteral', members: [] };

    // Act
    visitor.TSTypeLiteral(node);

    // Assert
    expect(reports.length).toBe(0);
  });
});
