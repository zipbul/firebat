import { describe, expect, it } from 'bun:test';

import type { AstNode, Range, Variable } from '../types';

import {
  applyAutofix,
  applyFixes,
  setupRule,
  expectReportCount,
} from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { buildCommaTokens } from '../../../test/integration/oxlint-plugin/utils/token-utils';
import { unusedImportsRule } from './unused-imports';

/** A declared variable whose identifier sits at `idRange` and whose references occupy `refRanges`. */
function declared(idRange: Range, refRanges: Range[]): Variable {
  return {
    identifiers: [{ type: 'Identifier', range: idRange }],
    references: refRanges.map(range => ({ type: 'Identifier', range })),
  };
}

/** An import specifier named `name`, occupying `range`, whose local identifier sits at `localRange` (defaults to `range`). */
function spec(name: string, range: Range, localRange: Range = range): AstNode {
  return {
    type: 'ImportSpecifier',
    range,
    local: { type: 'Identifier', name, range: localRange },
  };
}

/** Locate the [start, end) range of `name` within `text`. */
function rangeOf(text: string, name: string): Range {
  const start = text.indexOf(name);

  return [start, start + name.length];
}

/** Run the ImportDeclaration visitor over `node`, asserting one report tagged `messageId`. */
function expectReport(
  visitor: Parameters<typeof expectReportCount>[0],
  node: Parameters<typeof expectReportCount>[2],
  reports: ReturnType<typeof setupRule>['reports'],
  messageId: string,
): void {
  expectReportCount(visitor, 'ImportDeclaration', node, reports, 1);
  expect(reports[0]?.messageId).toBe(messageId);
}

/**
 * Set up the rule over an `{ alpha, beta }` import (alpha referenced, beta unused),
 * the dominant autofix arrange shape. `text` decides the source layout.
 */
function setupAlphaBeta(text: string) {
  const alpha = rangeOf(text, 'alpha');
  const beta = rangeOf(text, 'beta');
  const tokens = buildCommaTokens(text);

  const getDeclaredVariables = () => [declared(alpha, [[100, 101]]), declared(beta, [])] satisfies Variable[];

  const { visitor, reports } = setupRule(unusedImportsRule, { text, tokens, getDeclaredVariables });
  const importNode: AstNode = {
    type: 'ImportDeclaration',
    range: [0, text.length],
    specifiers: [spec('alpha', alpha), spec('beta', beta)],
  };

  return { visitor, reports, importNode };
}

describe('unused-imports', () => {
  it('should report unused import declarations when references are missing', () => {
    // Arrange
    const getDeclaredVariables = () => [declared([5, 10], [])] satisfies Variable[];

    const { visitor, reports } = setupRule(unusedImportsRule, { getDeclaredVariables });
    const importNode: AstNode = {
      type: 'ImportDeclaration',
      specifiers: [spec('alpha', [0, 10], [5, 10])],
    };

    // Act
    expectReport(visitor, importNode, reports, 'unusedImportDeclaration');
  });

  it('should skip report when import is referenced', () => {
    // Arrange
    const getDeclaredVariables = () => [declared([5, 10], [[20, 25]])] satisfies Variable[];

    const { visitor, reports } = setupRule(unusedImportsRule, { getDeclaredVariables });
    const importNode: AstNode = {
      type: 'ImportDeclaration',
      specifiers: [spec('alpha', [0, 10], [5, 10])],
    };

    // Act
    expectReportCount(visitor, 'ImportDeclaration', importNode, reports, 0);
  });

  it('should report when one of multiple imports is unused', () => {
    // Arrange
    const getDeclaredVariables = () => [declared([5, 10], []), declared([12, 18], [[30, 35]])] satisfies Variable[];

    const { visitor, reports } = setupRule(unusedImportsRule, { getDeclaredVariables });
    const importNode: AstNode = {
      type: 'ImportDeclaration',
      specifiers: [spec('alpha', [0, 10], [5, 10]), spec('beta', [11, 18], [12, 18])],
    };

    // Act
    expectReport(visitor, importNode, reports, 'unusedImport');
  });

  it('should autofix unused specifier when comma handling is required', () => {
    // Arrange
    const text = "import { alpha, beta } from 'x';";
    const { visitor, reports, importNode } = setupAlphaBeta(text);

    // Act
    expectReport(visitor, importNode, reports, 'unusedImport');

    const fixed = applyAutofix(text, reports);

    expect(fixed).toBe("import { alpha } from 'x';");

    // Re-run should be clean.
    const alpha2 = rangeOf(fixed, 'alpha');

    const getDeclaredVariables2 = () => [declared(alpha2, [[200, 201]])] satisfies Variable[];

    const { visitor: visitor2, reports: reports2 } = setupRule(unusedImportsRule, {
      text: fixed,
      getDeclaredVariables: getDeclaredVariables2,
    });
    const importNode2: AstNode = {
      type: 'ImportDeclaration',
      range: [0, fixed.length],
      specifiers: [spec('alpha', alpha2)],
    };

    // Act
    expectReportCount(visitor2, 'ImportDeclaration', importNode2, reports2, 0);
  });

  it('should autofix when import declaration is unused', () => {
    // Arrange
    const text = "import { alpha } from 'x';";
    const alpha = rangeOf(text, 'alpha');

    const getDeclaredVariables = () => [declared(alpha, [])] satisfies Variable[];

    const { visitor, reports } = setupRule(unusedImportsRule, { text, getDeclaredVariables });
    const importNode: AstNode = {
      type: 'ImportDeclaration',
      range: [0, text.length],
      specifiers: [spec('alpha', alpha)],
    };

    // Act
    expectReport(visitor, importNode, reports, 'unusedImportDeclaration');

    const fixed = applyAutofix(text, reports);

    expect(fixed).toBe('');
  });

  it('should refuse autofix when import is type-only', () => {
    // Arrange
    const text = "import type { alpha } from 'x';";
    const alpha = rangeOf(text, 'alpha');

    const getDeclaredVariables = () => [declared(alpha, [])] satisfies Variable[];

    const { visitor, reports } = setupRule(unusedImportsRule, { text, getDeclaredVariables });
    const importNode: AstNode = {
      type: 'ImportDeclaration',
      importKind: 'type',
      range: [0, text.length],
      specifiers: [spec('alpha', alpha)],
    };

    // Act
    expectReport(visitor, importNode, reports, 'unusedImportDeclaration');

    const fixed = applyFixes(text, reports);

    expect(fixed).toBe(text);
  });

  it('should refuse autofix when specifier removal is multiline', () => {
    // Arrange
    const text = "import { alpha,\n  beta } from 'x';";
    const { visitor, reports, importNode } = setupAlphaBeta(text);

    // Act
    expectReport(visitor, importNode, reports, 'unusedImport');

    const fixed = applyAutofix(text, reports);

    expect(fixed).toBe(text);
  });

  it('should refuse autofix when multiple specifiers are unused', () => {
    // Arrange
    const text = "import { alpha, beta, gamma } from 'x';";
    const alpha = rangeOf(text, 'alpha');
    const beta = rangeOf(text, 'beta');
    const gamma = rangeOf(text, 'gamma');

    const getDeclaredVariables = () =>
      [declared(alpha, [[100, 101]]), declared(beta, []), declared(gamma, [])] satisfies Variable[];

    const { visitor, reports } = setupRule(unusedImportsRule, { text, getDeclaredVariables });

    // Act
    visitor.ImportDeclaration({
      type: 'ImportDeclaration',
      range: [0, text.length],
      specifiers: [spec('alpha', alpha), spec('beta', beta), spec('gamma', gamma)],
    });

    // Assert
    expect(reports.length).toBe(2);
    expect(reports.every(r => typeof r.fix !== 'function')).toBe(true);

    const fixed = applyFixes(text, reports);

    expect(fixed).toBe(text);
  });
});
