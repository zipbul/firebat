import { describe, expect, it } from 'bun:test';

import type { AstNode, Range } from '../types';

import { applyAutofix, setupRule } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { paddingLineBetweenStatementsRule } from './padding-line-between-statements';

/** const declaration node with an optional source location (line span). */
function constDecl(range: Range, lines?: [number, number]): AstNode {
  const node: AstNode = { type: 'VariableDeclaration', kind: 'const', range, declarations: [] };

  if (lines) {
    node.loc = {
      start: { line: lines[0], column: 0 },
      end: { line: lines[1], column: range[1] - range[0] },
    };
  }

  return node;
}

const funcDecl = (range: Range): AstNode => ({ type: 'FunctionDeclaration', range });

const program = (body: AstNode[]): AstNode => ({ type: 'Program', body });

/** Set up the rule over `text`, run the Program visitor on `body`, and return the reports. */
function runProgram(text: string, body: AstNode[]): ReturnType<typeof setupRule>['reports'] {
  const { visitor, reports } = setupRule(paddingLineBetweenStatementsRule, { text });

  visitor.Program(program(body));

  return reports;
}

/** Assert one report tagged `messageId` with a fix that rewrites `text` to `expected`; returns the fixed text. */
function expectSingleFix(
  text: string,
  reports: ReturnType<typeof setupRule>['reports'],
  messageId: string,
  expected: string,
): string {
  expect(reports.length).toBe(1);
  expect(reports[0]?.messageId).toBe(messageId);

  const fixed = applyAutofix(text, reports);

  expect(fixed).toBe(expected);

  return fixed;
}

const SEPARATED_SRC = 'const alpha = 1;\n\nconst beta = 2;';

/** Run the rule over a blank-separated const pair and assert exactly one report. */
function reportsForSeparated(): ReturnType<typeof setupRule>['reports'] {
  const reports = runProgram(SEPARATED_SRC, [constDecl([0, 16], [1, 1]), constDecl([18, 33], [3, 3])]);

  expect(reports.length).toBe(1);

  return reports;
}

describe('padding-line-between-statements', () => {
  it('should report unexpected blank lines when const declarations are separated', () => {
    const reports = reportsForSeparated();

    expect(reports[0]?.messageId).toBe('unexpectedBlankLine');
  });

  it('should autofix unexpected blank lines when rule triggers', () => {
    const reports = reportsForSeparated();
    const fixed = applyAutofix(SEPARATED_SRC, reports);

    expect(fixed).toBe('const alpha = 1;\nconst beta = 2;');

    // Re-run should be clean.
    expect(runProgram(fixed, [constDecl([0, 16], [1, 1]), constDecl([17, 32], [2, 2])]).length).toBe(0);
  });

  it('should autofix missing blank line when required', () => {
    const text = 'const alpha = 1;\nfunction beta() {}';
    const reports = runProgram(text, [constDecl([0, 16]), funcDecl([17, 35])]);
    const fixed = expectSingleFix(text, reports, 'expectedBlankLine', 'const alpha = 1;\n\nfunction beta() {}');

    expect(runProgram(fixed, [constDecl([0, 16]), funcDecl([18, 36])]).length).toBe(0);
  });

  it('should autofix missing blank line when input uses CRLF', () => {
    const text = 'const alpha = 1;\r\nfunction beta() {}';
    const reports = runProgram(text, [constDecl([0, 16]), funcDecl([18, 36])]);
    const fixed = expectSingleFix(text, reports, 'expectedBlankLine', 'const alpha = 1;\r\n\r\nfunction beta() {}');

    expect(runProgram(fixed, [constDecl([0, 16]), funcDecl([20, 38])]).length).toBe(0);
  });

  it('should skip report when no blank line exists between const declarations', () => {
    const text = 'const alpha = 1;\nconst beta = 2;';
    const reports = runProgram(text, [constDecl([0, 16], [1, 1]), constDecl([17, 32], [2, 2])]);

    expect(reports.length).toBe(0);
  });
});
