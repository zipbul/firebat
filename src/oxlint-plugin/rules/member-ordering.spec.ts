import { describe, expect, it } from 'bun:test';

import type { AstNode } from '../types';

import { setupRule } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { memberOrderingRule } from './member-ordering';

describe('member-ordering', () => {
  it.each<[string, AstNode, AstNode]>([
    ['ordering is invalid', { type: 'MethodDefinition', kind: 'method' }, { type: 'PropertyDefinition' }],
    [
      'constructor appears after methods',
      { type: 'MethodDefinition', kind: 'method' },
      { type: 'MethodDefinition', kind: 'constructor' },
    ],
    [
      'static fields follow instance fields',
      { type: 'PropertyDefinition', static: false },
      { type: 'PropertyDefinition', static: true },
    ],
    [
      'public members follow private members',
      { type: 'MethodDefinition', accessibility: 'private' },
      { type: 'MethodDefinition', accessibility: 'public' },
    ],
  ])('should report members when %s', (_label, firstMember, secondMember) => {
    // Arrange
    const { visitor, reports } = setupRule(memberOrderingRule);
    const classBody: AstNode = { type: 'ClassBody', body: [firstMember, secondMember] };

    // Act
    visitor.ClassBody(classBody);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('invalidOrder');
  });

  it('should skip report when members follow the order', () => {
    // Arrange
    const { visitor, reports } = setupRule(memberOrderingRule);
    const fieldMember: AstNode = { type: 'PropertyDefinition' };
    const methodMember: AstNode = { type: 'MethodDefinition', kind: 'method' };
    const classBody: AstNode = { type: 'ClassBody', body: [fieldMember, methodMember] };

    // Act
    visitor.ClassBody(classBody);

    // Assert
    expect(reports.length).toBe(0);
  });
});
