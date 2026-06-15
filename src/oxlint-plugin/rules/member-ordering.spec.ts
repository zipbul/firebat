import { describe, expect, it } from 'bun:test';

import type { AstNode } from '../types';

import { setupRule } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { memberOrderingRule } from './member-ordering';

describe('member-ordering', () => {
  it('should report members when ordering is invalid', () => {
    // Arrange
    const { visitor, reports } = setupRule(memberOrderingRule);
    const methodMember: AstNode = { type: 'MethodDefinition', kind: 'method' };
    const fieldMember: AstNode = { type: 'PropertyDefinition' };
    const classBody: AstNode = { type: 'ClassBody', body: [methodMember, fieldMember] };

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

  it('should report when constructor appears after methods', () => {
    // Arrange
    const { visitor, reports } = setupRule(memberOrderingRule);
    const methodMember: AstNode = { type: 'MethodDefinition', kind: 'method' };
    const ctorMember: AstNode = { type: 'MethodDefinition', kind: 'constructor' };
    const classBody: AstNode = { type: 'ClassBody', body: [methodMember, ctorMember] };

    // Act
    visitor.ClassBody(classBody);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('invalidOrder');
  });

  it('should report when static fields follow instance fields', () => {
    // Arrange
    const { visitor, reports } = setupRule(memberOrderingRule);
    const instanceField: AstNode = { type: 'PropertyDefinition', static: false };
    const staticField: AstNode = { type: 'PropertyDefinition', static: true };
    const classBody: AstNode = { type: 'ClassBody', body: [instanceField, staticField] };

    // Act
    visitor.ClassBody(classBody);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('invalidOrder');
  });

  it('should report when public members follow private members', () => {
    // Arrange
    const { visitor, reports } = setupRule(memberOrderingRule);
    const privateMethod: AstNode = { type: 'MethodDefinition', accessibility: 'private' };
    const publicMethod: AstNode = { type: 'MethodDefinition', accessibility: 'public' };
    const classBody: AstNode = { type: 'ClassBody', body: [privateMethod, publicMethod] };

    // Act
    visitor.ClassBody(classBody);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('invalidOrder');
  });
});
