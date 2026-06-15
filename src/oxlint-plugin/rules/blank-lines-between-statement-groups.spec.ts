import { describe, expect, it } from 'bun:test';

import type { AstNode } from '../types';

import { applyFixes, setupRule } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { blankLinesBetweenStatementGroupsRule } from './blank-lines-between-statement-groups';

/** Program of a function declaration followed by a const, with the const at the given range. */
function funcThenConst(constRange: [number, number]): AstNode {
  const prevNode: AstNode = { type: 'FunctionDeclaration', range: [0, 19] };
  const nextNode: AstNode = { type: 'VariableDeclaration', kind: 'const', range: constRange, declarations: [] };

  return { type: 'Program', body: [prevNode, nextNode] };
}

describe('blank-lines-between-statement-groups', () => {
  it('should report when groups change without a blank line', () => {
    // Arrange
    const text = 'function alpha() {}\nconst beta = 1;';
    const { visitor, reports } = setupRule(blankLinesBetweenStatementGroupsRule, { text });

    // Act
    visitor.Program(funcThenConst([20, 35]));

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('expectedBlankLine');
  });

  it('should skip report when blank line exists between groups', () => {
    // Arrange
    const text = 'function alpha() {}\n\nconst beta = 1;';
    const { visitor, reports } = setupRule(blankLinesBetweenStatementGroupsRule, { text });

    // Act
    visitor.Program(funcThenConst([21, 36]));

    // Assert
    expect(reports.length).toBe(0);
  });

  it('should autofix when blank line is missing between groups', () => {
    // Arrange
    const text = 'function alpha() {}\nconst beta = 1;';
    const { visitor, reports } = setupRule(blankLinesBetweenStatementGroupsRule, { text });

    // Act
    visitor.Program(funcThenConst([20, 35]));

    // Assert
    expect(reports.length).toBe(1);
    expect(typeof reports[0]?.fix).toBe('function');

    const fixed = applyFixes(text, reports);

    expect(fixed).toBe('function alpha() {}\n\nconst beta = 1;');

    // Re-run on fixed input: should be clean.
    // Arrange
    const { visitor: visitor2, reports: reports2 } = setupRule(blankLinesBetweenStatementGroupsRule, { text: fixed });

    // Act
    visitor2.Program(funcThenConst([21, 36]));

    // Assert
    expect(reports2.length).toBe(0);
  });
});
