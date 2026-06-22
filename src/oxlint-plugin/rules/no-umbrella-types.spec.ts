import { describe, expect, it } from 'bun:test';

import type { AstNode } from '../types';

import { setupRule, expectReportCount } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { noUmbrellaTypesRule } from './no-umbrella-types';

describe('no-umbrella-types', () => {
  it('should report forbidden aliases when encountering umbrella types', () => {
    // Arrange
    const { visitor, reports } = setupRule(noUmbrellaTypesRule);
    const aliasNode: AstNode = { type: 'TSTypeReference', typeName: { type: 'Identifier', name: 'AnyValue' } };
    const objectNode: AstNode = { type: 'TSObjectKeyword' };

    // Act
    visitor.TSTypeReference(aliasNode);
    expectReportCount(visitor, 'TSObjectKeyword', objectNode, reports, 2);
    expect(reports[0]?.messageId).toBe('forbiddenAlias');
    expect(reports[1]?.messageId).toBe('objectKeyword');
  });

  it.each<[string, string, string[]]>([
    ['forbidden globals are referenced', 'Function', ['forbiddenGlobal']],
    ['type reference is allowed', 'AllowedType', []],
    ['generic references are forbidden', 'DeepPartial', ['forbiddenAlias']],
  ])('should produce expected reports when %s', (_label, name, expectedMessageIds) => {
    // Arrange
    const { visitor, reports } = setupRule(noUmbrellaTypesRule);
    const typeNode: AstNode = { type: 'TSTypeReference', typeName: { type: 'Identifier', name } };

    // Act
    visitor.TSTypeReference(typeNode);

    // Assert
    expect(reports.map(report => report.messageId)).toEqual(expectedMessageIds);
  });
});
