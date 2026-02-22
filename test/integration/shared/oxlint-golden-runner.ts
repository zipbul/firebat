/**
 * Golden test runner for oxlint-plugin rules.
 *
 * Uses the real oxc-parser to parse fixture source, walks the AST through
 * the rule visitor, and captures reports + fixed source as golden JSON.
 *
 * Usage inside a golden.test.ts:
 *
 *   import { runGoldenRule } from '../../shared/oxlint-golden-runner';
 *   import { noDoubleAssertionRule } from '../../../../src/oxlint-plugin/rules/no-double-assertion';
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

import { readExpected, toGoldenJson, writeExpected } from './golden-utils';

import type {
  AstNode,
  AstNodeValue,
  RuleContext,
  Variable,
} from '../../../src/oxlint-plugin/types';

import { applyFixes, createRuleContext, createSourceCode } from '../oxlint-plugin/utils/rule-test-kit';
import { buildCommaTokens } from '../oxlint-plugin/utils/token-utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Visitor {
  [key: string]: ((node: AstNode) => void) | undefined;
}

export interface RuleModule {
  create(context: RuleContext): Visitor;
}

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

// ── AST utilities (mirrors autofix-invariants-parser-fuzz.ts) ─────────────────

interface AstNodeShape {
  type?: string;
}

const isAstNode = (
  value: AstNodeValue | AstNodeShape | null | undefined,
): value is AstNode => {
  if (value === null || value === undefined || Array.isArray(value)) {
    return false;
  }

  if (typeof value !== 'object') {
    return false;
  }

  return typeof (value as AstNodeShape).type === 'string';
};

/**
 * The oxc-parser may produce `start`/`end` numeric fields alongside (or
 * instead of) `range`. Normalise them to the `range: [start, end]` form that
 * rule implementations expect.
 */
const ensureRangesDeep = (root: AstNodeValue | null | undefined): void => {
  const seen = new WeakSet<AstNode>();

  const walk = (value: AstNodeValue | null | undefined): void => {
    if (value === null || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }

      return;
    }

    if (!isAstNode(value)) {
      return;
    }

    if (seen.has(value)) {
      return;
    }

    seen.add(value);

    const start = (value as Record<string, unknown>)['start'];
    const end = (value as Record<string, unknown>)['end'];
    const range = value.range;

    if (!Array.isArray(range) && typeof start === 'number' && typeof end === 'number') {
      value.range = [start, end];
    }

    for (const key of Object.keys(value)) {
      if (key === 'parent') {
        continue;
      }

      const child = value[key];

      if (Array.isArray(child)) {
        for (const item of child) {
          walk(item);
        }

        continue;
      }

      walk(child);
    }
  };

  walk(root);
};

const traverseAndVisit = (
  root: AstNodeValue | null | undefined,
  visitor: Visitor,
): void => {
  const seen = new WeakSet<AstNode>();

  const walk = (value: AstNodeValue | null | undefined): void => {
    if (value === null || value === undefined) {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item);
      }

      return;
    }

    if (!isAstNode(value)) {
      return;
    }

    if (seen.has(value)) {
      return;
    }

    seen.add(value);

    const handler = visitor[value.type];

    if (typeof handler === 'function') {
      handler(value);
    }

    for (const key of Object.keys(value)) {
      if (key === 'parent') {
        continue;
      }

      const child = value[key];

      if (Array.isArray(child)) {
        for (const item of child) {
          walk(item);
        }

        continue;
      }

      walk(child);
    }
  };

  walk(root);
};

/**
 * Build a getDeclaredVariables callback for import-aware rules (e.g. unused-imports).
 * Walks the real program AST to collect identifier usages.
 */
const buildGetDeclaredVariables = (
  program: AstNode,
): ((node: AstNode) => Variable[]) => {
  const getRangeTuple = (node: AstNode | null | undefined): [number, number] | null => {
    if (!node || !Array.isArray(node.range) || node.range.length !== 2) {
      return null;
    }

    const start = node.range[0];
    const end = node.range[1];

    if (typeof start !== 'number' || typeof end !== 'number') {
      return null;
    }

    return [start, end];
  };

  const collectUsages = (name: string, excludeRange: [number, number] | null): AstNode[] => {
    const out: AstNode[] = [];

    traverseAndVisit(program, {
      Identifier(node) {
        if (typeof node.name !== 'string' || node.name !== name) {
          return;
        }

        const range = getRangeTuple(node);

        if (!range) {
          return;
        }

        const es = excludeRange?.[0];
        const ee = excludeRange?.[1];

        if (es !== undefined && ee !== undefined && range[0] >= es && range[1] <= ee) {
          return;
        }

        out.push(node);
      },
    });

    return out;
  };

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

        const references = collectUsages(localName, importRange);

        vars.push({
          identifiers: [{ type: 'Identifier', range: localRange, name: localName }],
          references,
        } satisfies Variable);
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

        const references = collectUsages(idName, declRange);

        vars.push({
          identifiers: [{ type: 'Identifier', range: idRange, name: idName }],
          references,
        } satisfies Variable);
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

      const references = collectUsages(idName, nodeRange);

      return [{
        identifiers: [{ type: 'Identifier', range: idRange, name: idName }],
        references,
      } satisfies Variable];
    }

    return [];
  };
};

// ── Rule execution ────────────────────────────────────────────────────────────

const runRuleOnSource = (
  fixtureSource: string,
  rule: RuleModule,
  opts: RuleGoldenOptions = {},
): GoldenRuleResult => {
  const filename = opts.filename ?? 'fixture.ts';
  const options = opts.options ?? [];

  const parsed = oxcParseSync(filename, fixtureSource);
  const programValue = (parsed as unknown as { program: AstNodeValue }).program;

  if (!isAstNode(programValue)) {
    return { reports: [] };
  }

  ensureRangesDeep(programValue);

  const tokens = buildCommaTokens(fixtureSource);
  const sourceCode = createSourceCode(fixtureSource, null, null, tokens);
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
    const range = Array.isArray(node?.range) && node.range.length === 2
      ? (node.range as [number, number])
      : undefined;

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
export const runGoldenRule = (
  testDir: string,
  name: string,
  rule: RuleModule,
  opts: RuleGoldenOptions = {},
): void => {
  const fixturesDir = path.join(testDir, '__fixtures__');
  const expectedDir = path.join(testDir, '__expected__');

  it(`golden: ${name}`, () => {
    const source = readFixtureSource(fixturesDir, name);
    const actual = runRuleOnSource(source, rule, opts);
    const actualJson = toGoldenJson(actual);

    const expectedJson = readExpected(expectedDir, name);

    if (expectedJson === null) {
      writeExpected(expectedDir, name, actualJson);
      throw new Error(
        `[golden] Created new expected file for "${name}". ` +
          `Review ${path.join(expectedDir, `${name}.json`)} and re-run.`,
      );
    }

    const expectedParsed = JSON.parse(expectedJson.trim()) as unknown;
    const actualParsed = JSON.parse(actualJson) as unknown;

    expect(actualParsed).toEqual(expectedParsed);

    // ── Autofix round-trip + idempotency (P2-18) ──────────────────────────────
    if (typeof actual.fixedSource === 'string') {
      // Round-trip: applying fixes and re-running the rule should produce no reports.
      const roundTripResult = runRuleOnSource(actual.fixedSource, rule, opts);

      expect(roundTripResult.reports).toHaveLength(0);

      // Idempotency: applying fixes a second time should not change the source.
      const fixedAgain = typeof roundTripResult.fixedSource === 'string'
        ? roundTripResult.fixedSource
        : actual.fixedSource;

      expect(fixedAgain).toBe(actual.fixedSource);
    }
  });
};

