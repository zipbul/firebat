import { describe, expect, it } from 'bun:test';

import type { AstNode } from '../types';

import { applyFixes, setupRule } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { paddingLineBetweenStatementsRule } from './padding-line-between-statements';

describe('padding-line-between-statements', () => {
  it('should report unexpected blank lines when const declarations are separated', () => {
    // Arrange
    const text = 'const alpha = 1;\n\nconst beta = 2;';
    const { visitor, reports } = setupRule(paddingLineBetweenStatementsRule, { text });
    const prevNode: AstNode = {
      type: 'VariableDeclaration',
      kind: 'const',
      range: [0, 16],
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 16 } },
      declarations: [],
    };
    const nextNode: AstNode = {
      type: 'VariableDeclaration',
      kind: 'const',
      range: [18, 33],
      loc: { start: { line: 3, column: 0 }, end: { line: 3, column: 15 } },
      declarations: [],
    };
    const programNode: AstNode = { type: 'Program', body: [prevNode, nextNode] };

    // Act
    visitor.Program(programNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('unexpectedBlankLine');
  });

  it('should autofix unexpected blank lines when rule triggers', () => {
    // Arrange
    const text = 'const alpha = 1;\n\nconst beta = 2;';
    const { visitor, reports } = setupRule(paddingLineBetweenStatementsRule, { text });
    const prevNode: AstNode = {
      type: 'VariableDeclaration',
      kind: 'const',
      range: [0, 16],
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 16 } },
      declarations: [],
    };
    const nextNode: AstNode = {
      type: 'VariableDeclaration',
      kind: 'const',
      range: [18, 33],
      loc: { start: { line: 3, column: 0 }, end: { line: 3, column: 15 } },
      declarations: [],
    };
    const programNode: AstNode = { type: 'Program', body: [prevNode, nextNode] };

    // Act
    visitor.Program(programNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(typeof reports[0]?.fix).toBe('function');

    const fixed = applyFixes(text, reports);

    expect(fixed).toBe('const alpha = 1;\nconst beta = 2;');

    // Re-run should be clean.
    // Arrange
    const { visitor: visitor2, reports: reports2 } = setupRule(paddingLineBetweenStatementsRule, { text: fixed });
    const prevNode2: AstNode = {
      type: 'VariableDeclaration',
      kind: 'const',
      range: [0, 16],
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 16 } },
      declarations: [],
    };
    const nextNode2: AstNode = {
      type: 'VariableDeclaration',
      kind: 'const',
      range: [17, 32],
      loc: { start: { line: 2, column: 0 }, end: { line: 2, column: 15 } },
      declarations: [],
    };
    const programNode2: AstNode = { type: 'Program', body: [prevNode2, nextNode2] };

    // Act
    visitor2.Program(programNode2);

    // Assert
    expect(reports2.length).toBe(0);
  });

  it('should autofix missing blank line when required', () => {
    // Arrange
    const text = 'const alpha = 1;\nfunction beta() {}';
    const { visitor, reports } = setupRule(paddingLineBetweenStatementsRule, { text });
    const prevNode: AstNode = {
      type: 'VariableDeclaration',
      kind: 'const',
      range: [0, 16],
      declarations: [],
    };
    const nextNode: AstNode = {
      type: 'FunctionDeclaration',
      range: [17, 35],
    };
    const programNode: AstNode = { type: 'Program', body: [prevNode, nextNode] };

    // Act
    visitor.Program(programNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('expectedBlankLine');
    expect(typeof reports[0]?.fix).toBe('function');

    const fixed = applyFixes(text, reports);

    expect(fixed).toBe('const alpha = 1;\n\nfunction beta() {}');

    // Arrange
    const { visitor: visitor2, reports: reports2 } = setupRule(paddingLineBetweenStatementsRule, { text: fixed });

    // Act
    visitor2.Program({
      type: 'Program',
      body: [
        { type: 'VariableDeclaration', kind: 'const', range: [0, 16], declarations: [] },
        { type: 'FunctionDeclaration', range: [18, 36] },
      ],
    });

    // Assert
    expect(reports2.length).toBe(0);
  });

  it('should autofix missing blank line when input uses CRLF', () => {
    // Arrange
    const text = 'const alpha = 1;\r\nfunction beta() {}';
    const { visitor, reports } = setupRule(paddingLineBetweenStatementsRule, { text });

    // Act
    visitor.Program({
      type: 'Program',
      body: [
        { type: 'VariableDeclaration', kind: 'const', range: [0, 16], declarations: [] },
        { type: 'FunctionDeclaration', range: [18, 36] },
      ],
    });

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('expectedBlankLine');
    expect(typeof reports[0]?.fix).toBe('function');

    const fixed = applyFixes(text, reports);

    expect(fixed).toBe('const alpha = 1;\r\n\r\nfunction beta() {}');

    // Arrange
    const { visitor: visitor2, reports: reports2 } = setupRule(paddingLineBetweenStatementsRule, { text: fixed });

    // Act
    visitor2.Program({
      type: 'Program',
      body: [
        { type: 'VariableDeclaration', kind: 'const', range: [0, 16], declarations: [] },
        { type: 'FunctionDeclaration', range: [20, 38] },
      ],
    });

    // Assert
    expect(reports2.length).toBe(0);
  });

  it('should skip report when no blank line exists between const declarations', () => {
    // Arrange
    const text = 'const alpha = 1;\nconst beta = 2;';
    const { visitor, reports } = setupRule(paddingLineBetweenStatementsRule, { text });
    const prevNode: AstNode = {
      type: 'VariableDeclaration',
      kind: 'const',
      range: [0, 16],
      loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 16 } },
      declarations: [],
    };
    const nextNode: AstNode = {
      type: 'VariableDeclaration',
      kind: 'const',
      range: [17, 32],
      loc: { start: { line: 2, column: 0 }, end: { line: 2, column: 15 } },
      declarations: [],
    };
    const programNode: AstNode = { type: 'Program', body: [prevNode, nextNode] };

    // Act
    visitor.Program(programNode);

    // Assert
    expect(reports.length).toBe(0);
  });
});
