import { describe, expect, it } from 'bun:test';

import type { AstNode } from '../types';

import { expectOneFix, setupRule } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { blankLinesBetweenStatementGroupsRule } from './blank-lines-between-statement-groups';

/** Program of a function declaration followed by a const, with the const at the given range. */
function funcThenConst(constRange: [number, number]): AstNode {
  const prevNode: AstNode = { type: 'FunctionDeclaration', range: [0, 19] };
  const nextNode: AstNode = { type: 'VariableDeclaration', kind: 'const', range: constRange, declarations: [] };

  return { type: 'Program', body: [prevNode, nextNode] };
}

/** Set up the rule over `text`, run the Program visitor on a func→const at `constRange`, and return the reports. */
function runProgram(text: string, constRange: [number, number]): ReturnType<typeof setupRule>['reports'] {
  const { visitor, reports } = setupRule(blankLinesBetweenStatementGroupsRule, { text });

  visitor.Program(funcThenConst(constRange));

  return reports;
}

describe('blank-lines-between-statement-groups', () => {
  it('should report when groups change without a blank line', () => {
    const reports = runProgram('function alpha() {}\nconst beta = 1;', [20, 35]);

    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('expectedBlankLine');
  });

  it('should skip report when blank line exists between groups', () => {
    const reports = runProgram('function alpha() {}\n\nconst beta = 1;', [21, 36]);

    expect(reports.length).toBe(0);
  });

  it('should autofix when blank line is missing between groups', () => {
    const text = 'function alpha() {}\nconst beta = 1;';
    const reports = runProgram(text, [20, 35]);
    const fixed = expectOneFix(text, reports);

    expect(fixed).toBe('function alpha() {}\n\nconst beta = 1;');

    // Re-run on fixed input: should be clean.
    expect(runProgram(fixed, [21, 36]).length).toBe(0);
  });
});
