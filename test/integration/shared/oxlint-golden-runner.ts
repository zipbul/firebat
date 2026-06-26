/**
 * Golden test runner for oxlint-plugin rules.
 *
 * Uses the real oxc-parser to parse fixture source, walks the AST through
 * the rule visitor, and captures reports + fixed source as golden JSON.
 *
 * Usage inside a golden.test.ts:
 *
 *   import { runGoldenRule } from '../../shared/oxlint-golden-runner';
 *   import { noDoubleAssertionRule } from '../../../../src/test-api';
 *
 *   runGoldenRule(import.meta.dir, 'basic', noDoubleAssertionRule);
 *
 * Fixture files    : <testDir>/__fixtures__/<name>.ts
 * Expected files   : <testDir>/__expected__/<name>.json
 *
 * Expected files are auto-created on first run; delete them to regenerate.
 */
import { expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseSync as oxcParseSync } from 'oxc-parser';

import type { AstNode, AstNodeValue, RuleContext, Variable } from '../../../src/test-api';

import {
  collectIdentifierUsages,
  ensureRangesDeep,
  isAstNode,
  type RuleModule,
  traverseAndVisit,
  type Visitor,
} from '../oxlint-plugin/utils/ast-walk';
import { getRange as getRangeTuple } from '../oxlint-plugin/utils/fuzz-rng';
import { applyFixes, createRuleContext, makeSourceCode } from '../oxlint-plugin/utils/rule-test-kit';
import { compareGolden } from './golden-utils';

// ── Types ─────────────────────────────────────────────────────────────────────

export type { RuleModule } from '../oxlint-plugin/utils/ast-walk';

export interface RuleGoldenOptions {
  /** Rule options array passed to createRuleContext. Defaults to []. */
  options?: RuleContext['options'];
  /** Filename for the virtual file (affects some rules). Defaults to 'fixture.ts'. */
  filename?: string;
  /** Optional fileExists callback for rules that check colocated files. */
  fileExists?: (filePath: string) => boolean;
  /** Optional readFile callback for rules that read colocated files. */
  readFile?: (filePath: string) => string | null;
}

interface GoldenReport {
  messageId: string;
  data?: Record<string, string>;
  /** Character range [start, end] of the reported node. */
  range?: [number, number];
}

interface GoldenRuleResult {
  reports: GoldenReport[];
  /** Present when at least one report has a fix. */
  fixedSource?: string;
}

// ── getDeclaredVariables ──────────────────────────────────────────────────────

/**
 * Build a getDeclaredVariables callback for import-aware rules (e.g. unused-imports).
 * Walks the real program AST to collect identifier usages.
 */
const buildGetDeclaredVariables = (program: AstNode): ((node: AstNode) => Variable[]) => {
  // Build one declared Variable: its sole identifier plus every usage outside
  // the declaration's own range. Shared by all declaration kinds below so the
  // identifier+references shape lives in one place.
  const buildVariable = (name: string, idRange: [number, number], excludeRange: [number, number] | null): Variable => ({
    identifiers: [{ type: 'Identifier', range: idRange, name }],
    references: collectIdentifierUsages(program, name, excludeRange, getRangeTuple),
  });

  return (node: AstNode): Variable[] => {
    if (node.type === 'ImportDeclaration') {
      const specifiers = Array.isArray(node.specifiers) ? node.specifiers : [];
      const importRange = getRangeTuple(node);
      const vars: Variable[] = [];

      for (const spec of specifiers) {
        const local = spec.local;
        const localName = typeof local?.name === 'string' ? local.name : null;
        const localRange = getRangeTuple(local ?? undefined);

        if (typeof localName !== 'string' || localName.length === 0 || !localRange) {
          continue;
        }

        vars.push(buildVariable(localName, localRange, importRange));
      }

      return vars;
    }

    if (node.type === 'VariableDeclaration') {
      const declarations = Array.isArray(node.declarations) ? node.declarations : [];
      const vars: Variable[] = [];
      const declRange = getRangeTuple(node);

      for (const declarator of declarations) {
        const id = declarator.id;

        if (!id || typeof id !== 'object' || id.type !== 'Identifier') {
          continue;
        }

        const idNode = id as AstNode;
        const idName = typeof idNode.name === 'string' ? idNode.name : null;
        const idRange = getRangeTuple(idNode);

        if (!idName || !idRange) {
          continue;
        }

        vars.push(buildVariable(idName, idRange, declRange));
      }

      return vars;
    }

    if (node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') {
      const id = node.id as AstNode | null | undefined;

      if (!id || typeof id !== 'object' || id.type !== 'Identifier') {
        return [];
      }

      const idName = typeof id.name === 'string' ? id.name : null;
      const idRange = getRangeTuple(id);
      const nodeRange = getRangeTuple(node);

      if (!idName || !idRange) {
        return [];
      }

      return [buildVariable(idName, idRange, nodeRange)];
    }

    return [];
  };
};

// ── Rule execution ────────────────────────────────────────────────────────────

const runRuleOnSource = (fixtureSource: string, rule: RuleModule, opts: RuleGoldenOptions = {}): GoldenRuleResult => {
  const filename = opts.filename ?? 'fixture.ts';
  const options = opts.options ?? [];
  const parsed = oxcParseSync(filename, fixtureSource);
  const programValue = (parsed as unknown as { program: AstNodeValue }).program;

  if (!isAstNode(programValue)) {
    return { reports: [] };
  }

  ensureRangesDeep(programValue);

    const sourceCode = makeSourceCode(fixtureSource);
  const getDeclaredVariables = buildGetDeclaredVariables(programValue);
  const extras: import('../oxlint-plugin/utils/rule-test-kit').RuleContextExtras = {};

  if (typeof filename === 'string' && filename !== 'fixture.ts') {
    extras.filename = filename;
  }

  if (typeof opts.fileExists === 'function') {
    extras.fileExists = opts.fileExists;
  }

  if (typeof opts.readFile === 'function') {
    extras.readFile = opts.readFile;
  }

  const { context, reports } = createRuleContext(sourceCode, options, getDeclaredVariables, extras);
  const visitor = rule.create(context);

  traverseAndVisit(programValue, visitor);

  const goldenReports: GoldenReport[] = reports.map(r => {
    const node = r.node as AstNode;
    const range = Array.isArray(node?.range) && node.range.length === 2 ? (node.range as [number, number]) : undefined;
    const entry: GoldenReport = { messageId: r.messageId };

    if (r.data && Object.keys(r.data).length > 0) {
      entry.data = r.data;
    }

    if (range) {
      entry.range = range;
    }

    return entry;
  });
  const result: GoldenRuleResult = { reports: goldenReports };

  if (reports.some(r => typeof r.fix === 'function')) {
    result.fixedSource = applyFixes(fixtureSource, reports);
  }

  return result;
};

// ── Fixture I/O ──────────────────────────────────────────────────────────────

const readFixtureSource = (fixturesDir: string, name: string): string => {
  const p = path.join(fixturesDir, `${name}.ts`);

  if (!fs.existsSync(p)) {
    throw new Error(`Fixture not found: ${p}`);
  }

  return fs.readFileSync(p, 'utf8');
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Register a single oxlint-rule golden test case.
 *
 * @param testDir  - Pass `import.meta.dir` from the calling test file
 * @param name     - Fixture name (without extension)
 * @param rule     - The rule module under test
 * @param opts     - Optional: rule options, filename override
 */
export const runGoldenRule = (testDir: string, name: string, rule: RuleModule, opts: RuleGoldenOptions = {}): void => {
  const fixturesDir = path.join(testDir, '__fixtures__');
  const expectedDir = path.join(testDir, '__expected__');

  it(`golden: ${name}`, () => {
    const source = readFixtureSource(fixturesDir, name);
    const actual = runRuleOnSource(source, rule, opts);

    compareGolden(expectedDir, name, actual);

    // ── Autofix round-trip + idempotency (P2-18) ──────────────────────────────
    if (typeof actual.fixedSource === 'string') {
      // Round-trip: applying fixes and re-running the rule should produce no reports.
      const roundTripResult = runRuleOnSource(actual.fixedSource, rule, opts);

      expect(roundTripResult.reports).toHaveLength(0);

      // Idempotency: applying fixes a second time should not change the source.
      const fixedAgain = typeof roundTripResult.fixedSource === 'string' ? roundTripResult.fixedSource : actual.fixedSource;

      expect(fixedAgain).toBe(actual.fixedSource);
    }
  });
};
