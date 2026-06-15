import { describe, expect, it } from 'bun:test';

import type { AstNode } from '../types';

import { applyFixes, setupRule } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { paddingLineBetweenStatementsRule } from './padding-line-between-statements';

type Range = [number, number];

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

describe('padding-line-between-statements', () => {
  it('should report unexpected blank lines when const declarations are separated', () => {
    // Arrange
    const text = 'const alpha = 1;\n\nconst beta = 2;';
    const { visitor, reports } = setupRule(paddingLineBetweenStatementsRule, { text });

    // Act
    visitor.Program(program([constDecl([0, 16], [1, 1]), constDecl([18, 33], [3, 3])]));

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('unexpectedBlankLine');
  });

  it('should autofix unexpected blank lines when rule triggers', () => {
    // Arrange
    const text = 'const alpha = 1;\n\nconst beta = 2;';
    const { visitor, reports } = setupRule(paddingLineBetweenStatementsRule, { text });

    // Act
    visitor.Program(program([constDecl([0, 16], [1, 1]), constDecl([18, 33], [3, 3])]));

    // Assert
    expect(reports.length).toBe(1);
    expect(typeof reports[0]?.fix).toBe('function');

    const fixed = applyFixes(text, reports);

    expect(fixed).toBe('const alpha = 1;\nconst beta = 2;');

    // Re-run should be clean.
    // Arrange
    const { visitor: visitor2, reports: reports2 } = setupRule(paddingLineBetweenStatementsRule, { text: fixed });

    // Act
    visitor2.Program(program([constDecl([0, 16], [1, 1]), constDecl([17, 32], [2, 2])]));

    // Assert
    expect(reports2.length).toBe(0);
  });

  it('should autofix missing blank line when required', () => {
    // Arrange
    const text = 'const alpha = 1;\nfunction beta() {}';
    const { visitor, reports } = setupRule(paddingLineBetweenStatementsRule, { text });

    // Act
    visitor.Program(program([constDecl([0, 16]), funcDecl([17, 35])]));

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('expectedBlankLine');
    expect(typeof reports[0]?.fix).toBe('function');

    const fixed = applyFixes(text, reports);

    expect(fixed).toBe('const alpha = 1;\n\nfunction beta() {}');

    // Arrange
    const { visitor: visitor2, reports: reports2 } = setupRule(paddingLineBetweenStatementsRule, { text: fixed });

    // Act
    visitor2.Program(program([constDecl([0, 16]), funcDecl([18, 36])]));

    // Assert
    expect(reports2.length).toBe(0);
  });

  it('should autofix missing blank line when input uses CRLF', () => {
    // Arrange
    const text = 'const alpha = 1;\r\nfunction beta() {}';
    const { visitor, reports } = setupRule(paddingLineBetweenStatementsRule, { text });

    // Act
    visitor.Program(program([constDecl([0, 16]), funcDecl([18, 36])]));

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('expectedBlankLine');
    expect(typeof reports[0]?.fix).toBe('function');

    const fixed = applyFixes(text, reports);

    expect(fixed).toBe('const alpha = 1;\r\n\r\nfunction beta() {}');

    // Arrange
    const { visitor: visitor2, reports: reports2 } = setupRule(paddingLineBetweenStatementsRule, { text: fixed });

    // Act
    visitor2.Program(program([constDecl([0, 16]), funcDecl([20, 38])]));

    // Assert
    expect(reports2.length).toBe(0);
  });

  it('should skip report when no blank line exists between const declarations', () => {
    // Arrange
    const text = 'const alpha = 1;\nconst beta = 2;';
    const { visitor, reports } = setupRule(paddingLineBetweenStatementsRule, { text });

    // Act
    visitor.Program(program([constDecl([0, 16], [1, 1]), constDecl([17, 32], [2, 2])]));

    // Assert
    expect(reports.length).toBe(0);
  });
});
