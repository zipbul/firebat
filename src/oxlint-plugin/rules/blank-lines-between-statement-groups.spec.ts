import { describe, expect, it } from 'bun:test';

import type { AstNode } from '../types';

import { applyFixes, setupRule } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { blankLinesBetweenStatementGroupsRule } from './blank-lines-between-statement-groups';

describe('blank-lines-between-statement-groups', () => {
  it('should report when groups change without a blank line', () => {
    // Arrange
    const text = 'function alpha() {}\nconst beta = 1;';
    const { visitor, reports } = setupRule(blankLinesBetweenStatementGroupsRule, { text });
    const prevNode: AstNode = { type: 'FunctionDeclaration', range: [0, 19] };
    const nextNode: AstNode = { type: 'VariableDeclaration', kind: 'const', range: [20, 35], declarations: [] };
    const programNode: AstNode = { type: 'Program', body: [prevNode, nextNode] };

    // Act
    visitor.Program(programNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('expectedBlankLine');
  });

  it('should skip report when blank line exists between groups', () => {
    // Arrange
    const text = 'function alpha() {}\n\nconst beta = 1;';
    const { visitor, reports } = setupRule(blankLinesBetweenStatementGroupsRule, { text });
    const prevNode: AstNode = { type: 'FunctionDeclaration', range: [0, 19] };
    const nextNode: AstNode = { type: 'VariableDeclaration', kind: 'const', range: [21, 36], declarations: [] };
    const programNode: AstNode = { type: 'Program', body: [prevNode, nextNode] };

    // Act
    visitor.Program(programNode);

    // Assert
    expect(reports.length).toBe(0);
  });

  it('should autofix when blank line is missing between groups', () => {
    // Arrange
    const text = 'function alpha() {}\nconst beta = 1;';
    const { visitor, reports } = setupRule(blankLinesBetweenStatementGroupsRule, { text });
    const prevNode: AstNode = { type: 'FunctionDeclaration', range: [0, 19] };
    const nextNode: AstNode = { type: 'VariableDeclaration', kind: 'const', range: [20, 35], declarations: [] };
    const programNode: AstNode = { type: 'Program', body: [prevNode, nextNode] };

    // Act
    visitor.Program(programNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(typeof reports[0]?.fix).toBe('function');

    const fixed = applyFixes(text, reports);

    expect(fixed).toBe('function alpha() {}\n\nconst beta = 1;');

    // Re-run on fixed input: should be clean.
    // Arrange
    const { visitor: visitor2, reports: reports2 } = setupRule(blankLinesBetweenStatementGroupsRule, { text: fixed });
    const prevNode2: AstNode = { type: 'FunctionDeclaration', range: [0, 19] };
    const nextNode2: AstNode = { type: 'VariableDeclaration', kind: 'const', range: [21, 36], declarations: [] };
    const programNode2: AstNode = { type: 'Program', body: [prevNode2, nextNode2] };

    // Act
    visitor2.Program(programNode2);

    // Assert
    expect(reports2.length).toBe(0);
  });
});
