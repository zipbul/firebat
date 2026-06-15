import { describe, expect, it } from 'bun:test';

import type { AstNode } from '../types';

import { setupRule } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { noUmbrellaTypesRule } from './no-umbrella-types';

describe('no-umbrella-types', () => {
  it('should report forbidden aliases when encountering umbrella types', () => {
    // Arrange
    const { visitor, reports } = setupRule(noUmbrellaTypesRule);
    const aliasNode: AstNode = { type: 'TSTypeReference', typeName: { type: 'Identifier', name: 'AnyValue' } };
    const objectNode: AstNode = { type: 'TSObjectKeyword' };

    // Act
    visitor.TSTypeReference(aliasNode);
    visitor.TSObjectKeyword(objectNode);

    // Assert
    expect(reports.length).toBe(2);
    expect(reports[0]?.messageId).toBe('forbiddenAlias');
    expect(reports[1]?.messageId).toBe('objectKeyword');
  });

  it('should report forbidden globals when referenced', () => {
    // Arrange
    const { visitor, reports } = setupRule(noUmbrellaTypesRule);
    const typeNode: AstNode = { type: 'TSTypeReference', typeName: { type: 'Identifier', name: 'Function' } };

    // Act
    visitor.TSTypeReference(typeNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('forbiddenGlobal');
  });

  it('should skip report when type reference is allowed', () => {
    // Arrange
    const { visitor, reports } = setupRule(noUmbrellaTypesRule);
    const typeNode: AstNode = { type: 'TSTypeReference', typeName: { type: 'Identifier', name: 'AllowedType' } };

    // Act
    visitor.TSTypeReference(typeNode);

    // Assert
    expect(reports.length).toBe(0);
  });

  it('should report generic references when they are forbidden', () => {
    // Arrange
    const { visitor, reports } = setupRule(noUmbrellaTypesRule);
    // DeepPartial<T>
    const typeNode: AstNode = { type: 'TSTypeReference', typeName: { type: 'Identifier', name: 'DeepPartial' } };

    // Act
    visitor.TSTypeReference(typeNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('forbiddenAlias');
  });
});
