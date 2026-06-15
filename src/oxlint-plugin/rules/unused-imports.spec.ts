import { describe, expect, it } from 'bun:test';

import type { AstNode, Variable } from '../types';

import { applyFixes, setupRule } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { buildCommaTokens } from '../../../test/integration/oxlint-plugin/utils/token-utils';
import { unusedImportsRule } from './unused-imports';

describe('unused-imports', () => {
  it('should report unused import declarations when references are missing', () => {
    // Arrange
    const getDeclaredVariables = () =>
      [
        {
          identifiers: [{ type: 'Identifier', range: [5, 10] }],
          references: [],
        },
      ] satisfies Variable[];

    const { visitor, reports } = setupRule(unusedImportsRule, { getDeclaredVariables });
    const importNode: AstNode = {
      type: 'ImportDeclaration',
      specifiers: [
        {
          type: 'ImportSpecifier',
          local: { type: 'Identifier', name: 'alpha', range: [5, 10] },
          range: [0, 10],
        },
      ],
    };

    // Act
    visitor.ImportDeclaration(importNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('unusedImportDeclaration');
  });

  it('should skip report when import is referenced', () => {
    // Arrange
    const getDeclaredVariables = () =>
      [
        {
          identifiers: [{ type: 'Identifier', range: [5, 10] }],
          references: [{ type: 'Identifier', range: [20, 25] }],
        },
      ] satisfies Variable[];

    const { visitor, reports } = setupRule(unusedImportsRule, { getDeclaredVariables });
    const importNode: AstNode = {
      type: 'ImportDeclaration',
      specifiers: [
        {
          type: 'ImportSpecifier',
          local: { type: 'Identifier', name: 'alpha', range: [5, 10] },
          range: [0, 10],
        },
      ],
    };

    // Act
    visitor.ImportDeclaration(importNode);

    // Assert
    expect(reports.length).toBe(0);
  });

  it('should report when one of multiple imports is unused', () => {
    // Arrange
    const getDeclaredVariables = () =>
      [
        {
          identifiers: [{ type: 'Identifier', range: [5, 10] }],
          references: [],
        },
        {
          identifiers: [{ type: 'Identifier', range: [12, 18] }],
          references: [{ type: 'Identifier', range: [30, 35] }],
        },
      ] satisfies Variable[];

    const { visitor, reports } = setupRule(unusedImportsRule, { getDeclaredVariables });
    const importNode: AstNode = {
      type: 'ImportDeclaration',
      specifiers: [
        {
          type: 'ImportSpecifier',
          local: { type: 'Identifier', name: 'alpha', range: [5, 10] },
          range: [0, 10],
        },
        {
          type: 'ImportSpecifier',
          local: { type: 'Identifier', name: 'beta', range: [12, 18] },
          range: [11, 18],
        },
      ],
    };

    // Act
    visitor.ImportDeclaration(importNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('unusedImport');
  });

  it('should autofix unused specifier when comma handling is required', () => {
    // Arrange
    const text = "import { alpha, beta } from 'x';";
    const alphaStart = text.indexOf('alpha');
    const alphaEnd = alphaStart + 'alpha'.length;
    const betaStart = text.indexOf('beta');
    const betaEnd = betaStart + 'beta'.length;
    const tokens = buildCommaTokens(text);

    const getDeclaredVariables = () =>
      [
        {
          identifiers: [{ type: 'Identifier', range: [alphaStart, alphaEnd] }],
          references: [{ type: 'Identifier', range: [100, 101] }],
        },
        {
          identifiers: [{ type: 'Identifier', range: [betaStart, betaEnd] }],
          references: [],
        },
      ] satisfies Variable[];

    const { visitor, reports } = setupRule(unusedImportsRule, { text, tokens, getDeclaredVariables });
    const importNode: AstNode = {
      type: 'ImportDeclaration',
      range: [0, text.length],
      specifiers: [
        {
          type: 'ImportSpecifier',
          range: [alphaStart, alphaEnd],
          local: { type: 'Identifier', name: 'alpha', range: [alphaStart, alphaEnd] },
        },
        {
          type: 'ImportSpecifier',
          range: [betaStart, betaEnd],
          local: { type: 'Identifier', name: 'beta', range: [betaStart, betaEnd] },
        },
      ],
    };

    // Act
    visitor.ImportDeclaration(importNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('unusedImport');
    expect(typeof reports[0]?.fix).toBe('function');

    const fixed = applyFixes(text, reports);

    expect(fixed).toBe("import { alpha } from 'x';");

    // Re-run should be clean.
    const text2 = fixed;
    const alphaStart2 = text2.indexOf('alpha');
    const alphaEnd2 = alphaStart2 + 'alpha'.length;

    const getDeclaredVariables2 = () =>
      [
        {
          identifiers: [{ type: 'Identifier', range: [alphaStart2, alphaEnd2] }],
          references: [{ type: 'Identifier', range: [200, 201] }],
        },
      ] satisfies Variable[];

    const { visitor: visitor2, reports: reports2 } = setupRule(unusedImportsRule, { text: text2, getDeclaredVariables: getDeclaredVariables2 });
    const importNode2: AstNode = {
      type: 'ImportDeclaration',
      range: [0, text2.length],
      specifiers: [
        {
          type: 'ImportSpecifier',
          range: [alphaStart2, alphaEnd2],
          local: { type: 'Identifier', name: 'alpha', range: [alphaStart2, alphaEnd2] },
        },
      ],
    };

    // Act
    visitor2.ImportDeclaration(importNode2);

    // Assert
    expect(reports2.length).toBe(0);
  });

  it('should autofix when import declaration is unused', () => {
    // Arrange
    const text = "import { alpha } from 'x';";
    const alphaStart = text.indexOf('alpha');
    const alphaEnd = alphaStart + 'alpha'.length;

    const getDeclaredVariables = () =>
      [
        {
          identifiers: [{ type: 'Identifier', range: [alphaStart, alphaEnd] }],
          references: [],
        },
      ] satisfies Variable[];

    const { visitor, reports } = setupRule(unusedImportsRule, { text, getDeclaredVariables });
    const importNode: AstNode = {
      type: 'ImportDeclaration',
      range: [0, text.length],
      specifiers: [
        {
          type: 'ImportSpecifier',
          range: [alphaStart, alphaEnd],
          local: { type: 'Identifier', name: 'alpha', range: [alphaStart, alphaEnd] },
        },
      ],
    };

    // Act
    visitor.ImportDeclaration(importNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('unusedImportDeclaration');
    expect(typeof reports[0]?.fix).toBe('function');

    const fixed = applyFixes(text, reports);

    expect(fixed).toBe('');
  });

  it('should refuse autofix when import is type-only', () => {
    // Arrange
    const text = "import type { alpha } from 'x';";
    const alphaStart = text.indexOf('alpha');
    const alphaEnd = alphaStart + 'alpha'.length;

    const getDeclaredVariables = () =>
      [
        {
          identifiers: [{ type: 'Identifier', range: [alphaStart, alphaEnd] }],
          references: [],
        },
      ] satisfies Variable[];

    const { visitor, reports } = setupRule(unusedImportsRule, { text, getDeclaredVariables });
    const importNode: AstNode = {
      type: 'ImportDeclaration',
      importKind: 'type',
      range: [0, text.length],
      specifiers: [
        {
          type: 'ImportSpecifier',
          range: [alphaStart, alphaEnd],
          local: { type: 'Identifier', name: 'alpha', range: [alphaStart, alphaEnd] },
        },
      ],
    };

    // Act
    visitor.ImportDeclaration(importNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('unusedImportDeclaration');

    const fixed = applyFixes(text, reports);

    expect(fixed).toBe(text);
  });

  it('should refuse autofix when specifier removal is multiline', () => {
    // Arrange
    const text = "import { alpha,\n  beta } from 'x';";
    const alphaStart = text.indexOf('alpha');
    const alphaEnd = alphaStart + 'alpha'.length;
    const betaStart = text.indexOf('beta');
    const betaEnd = betaStart + 'beta'.length;
    const tokens = buildCommaTokens(text);

    const getDeclaredVariables = () =>
      [
        {
          identifiers: [{ type: 'Identifier', range: [alphaStart, alphaEnd] }],
          references: [{ type: 'Identifier', range: [100, 101] }],
        },
        {
          identifiers: [{ type: 'Identifier', range: [betaStart, betaEnd] }],
          references: [],
        },
      ] satisfies Variable[];

    const { visitor, reports } = setupRule(unusedImportsRule, { text, tokens, getDeclaredVariables });
    const importNode: AstNode = {
      type: 'ImportDeclaration',
      range: [0, text.length],
      specifiers: [
        {
          type: 'ImportSpecifier',
          range: [alphaStart, alphaEnd],
          local: { type: 'Identifier', name: 'alpha', range: [alphaStart, alphaEnd] },
        },
        {
          type: 'ImportSpecifier',
          range: [betaStart, betaEnd],
          local: { type: 'Identifier', name: 'beta', range: [betaStart, betaEnd] },
        },
      ],
    };

    // Act
    visitor.ImportDeclaration(importNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('unusedImport');
    expect(typeof reports[0]?.fix).toBe('function');

    const fixed = applyFixes(text, reports);

    expect(fixed).toBe(text);
  });

  it('should refuse autofix when multiple specifiers are unused', () => {
    // Arrange
    const text = "import { alpha, beta, gamma } from 'x';";
    const alphaStart = text.indexOf('alpha');
    const alphaEnd = alphaStart + 'alpha'.length;
    const betaStart = text.indexOf('beta');
    const betaEnd = betaStart + 'beta'.length;
    const gammaStart = text.indexOf('gamma');
    const gammaEnd = gammaStart + 'gamma'.length;

    const getDeclaredVariables = () =>
      [
        {
          identifiers: [{ type: 'Identifier', range: [alphaStart, alphaEnd] }],
          references: [{ type: 'Identifier', range: [100, 101] }],
        },
        {
          identifiers: [{ type: 'Identifier', range: [betaStart, betaEnd] }],
          references: [],
        },
        {
          identifiers: [{ type: 'Identifier', range: [gammaStart, gammaEnd] }],
          references: [],
        },
      ] satisfies Variable[];

    const { visitor, reports } = setupRule(unusedImportsRule, { text, getDeclaredVariables });

    // Act
    visitor.ImportDeclaration({
      type: 'ImportDeclaration',
      range: [0, text.length],
      specifiers: [
        {
          type: 'ImportSpecifier',
          range: [alphaStart, alphaEnd],
          local: { type: 'Identifier', name: 'alpha', range: [alphaStart, alphaEnd] },
        },
        {
          type: 'ImportSpecifier',
          range: [betaStart, betaEnd],
          local: { type: 'Identifier', name: 'beta', range: [betaStart, betaEnd] },
        },
        {
          type: 'ImportSpecifier',
          range: [gammaStart, gammaEnd],
          local: { type: 'Identifier', name: 'gamma', range: [gammaStart, gammaEnd] },
        },
      ],
    });

    // Assert
    expect(reports.length).toBe(2);
    expect(reports.every(r => typeof r.fix !== 'function')).toBe(true);

    const fixed = applyFixes(text, reports);

    expect(fixed).toBe(text);
  });
});
