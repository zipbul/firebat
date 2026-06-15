import { describe, expect, it } from 'bun:test';

import type { AstNode } from '../types';

import { setupRule } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { noDynamicImportRule } from './no-dynamic-import';

describe('no-dynamic-import', () => {
  it('should report when import expression is non-literal', () => {
    // Arrange
    const { visitor, reports } = setupRule(noDynamicImportRule);
    const importNode: AstNode = { type: 'ImportExpression', source: { type: 'Identifier', name: 'path' } };

    // Act
    visitor.ImportExpression(importNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('dynamicImport');
  });

  it('should allow import expression when source is literal', () => {
    // Arrange
    const { visitor, reports } = setupRule(noDynamicImportRule);
    const importNode: AstNode = { type: 'ImportExpression', source: { type: 'Literal', value: './path' } };

    // Act
    visitor.ImportExpression(importNode);

    // Assert
    expect(reports.length).toBe(0);
  });
});
