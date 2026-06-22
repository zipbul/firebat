import { describe, expect, it } from 'bun:test';

import type { AstNode, JsonValue } from '../types';

import { setupRule, expectReportCount } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { noInlineObjectTypeRule } from './no-inline-object-type';

describe('no-inline-object-type', () => {
  it.each<[string, AstNode, JsonValue[], string[]]>([
    ['inline object types are encountered', { type: 'TSTypeLiteral' }, [], ['inlineObjectType']],
    ['empty object type is allowed via allowEmpty', { type: 'TSTypeLiteral', members: [] }, [{ allowEmpty: true }], []],
  ])('should produce expected reports when %s', (_label, node, options, expectedMessageIds) => {
    // Arrange
    const { visitor, reports } = setupRule(noInlineObjectTypeRule, { options });

    // Act
    visitor.TSTypeLiteral(node);

    // Assert
    expect(reports.map(report => report.messageId)).toEqual(expectedMessageIds);
  });

  it('should report each inline object when multiple occurrences exist', () => {
    // Arrange
    const { visitor, reports } = setupRule(noInlineObjectTypeRule);
    const firstNode: AstNode = { type: 'TSTypeLiteral' };
    const secondNode: AstNode = { type: 'TSTypeLiteral' };

    // Act
    visitor.TSTypeLiteral(firstNode);
    expectReportCount(visitor, 'TSTypeLiteral', secondNode, reports, 2);
    expect(reports[0]?.messageId).toBe('inlineObjectType');
    expect(reports[1]?.messageId).toBe('inlineObjectType');
  });
});
