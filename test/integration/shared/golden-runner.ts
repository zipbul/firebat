/**
 * Golden test runner for detector analyzers.
 *
 * Usage pattern inside a golden.test.ts:
 *
 *   import { runGolden } from '../../shared/golden-runner';
 *   import { detectWaste } from '../../../../src/features/waste';
 *
 *   runGolden(import.meta.dir, 'dead-store', sources => detectWaste(sources));
 *
 * Fixture files    : <testDir>/__fixtures__/<name>.ts   (TypeScript source)
 * Expected files   : <testDir>/__expected__/<name>.json (golden JSON)
 *
 * Expected files are auto-created on first run; delete them to regenerate.
 */
import { expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { ParsedFile } from '../../../src/engine/types';
import { parseSource } from '../../../src/engine/parse-source';
import { PartialResultError } from '../../../src/engine/partial-result-error';
import { normalizeValue, readExpected, toGoldenJson, writeExpected } from './golden-utils';

// ── Types ────────────────────────────────────────────────────────────────────

/** A multi-file fixture: Record<virtualPath, sourceText> */
export type FixtureSources = Record<string, string>;

/**
 * Analyzer function signature accepted by runGolden.
 * May return a plain value or a Promise.
 */
export type AnalyzerFn<T = unknown> = (
  program: ReadonlyArray<ParsedFile>,
  sources: FixtureSources,
) => T | Promise<T>;

// GoldenRunOptions removed — had a single `virtualRoot` field that was never
// used (void-discarded). Kept the export type for binary-compat but callers
// should omit the opts argument going forward.
export type GoldenRunOptions = Record<string, never>;

// ── Fixture loading ──────────────────────────────────────────────────────────

const readFixture = (fixturesDir: string, name: string): FixtureSources => {
  const fixturePath = path.join(fixturesDir, `${name}.ts`);

  if (!fs.existsSync(fixturePath)) {
    throw new Error(`Fixture not found: ${fixturePath}`);
  }

  const source = fs.readFileSync(fixturePath, 'utf8');

  return { [`/virtual/${name}.ts`]: source };
};

/**
 * Read a multi-file fixture from a directory named <name>.dir/
 * Each .ts file inside becomes a virtual path entry.
 */
const readDirFixture = (fixturesDir: string, name: string): FixtureSources => {
  const dirPath = path.join(fixturesDir, `${name}.dir`);

  if (!fs.existsSync(dirPath)) {
    return readFixture(fixturesDir, name);
  }

  const sources: FixtureSources = {};

  const collect = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const virtualPath = `${prefix}/${entry.name}`;

      if (entry.isDirectory()) {
        collect(fullPath, virtualPath);
      } else if (entry.name.endsWith('.ts')) {
        sources[virtualPath] = fs.readFileSync(fullPath, 'utf8');
      }
    }
  };

  collect(dirPath, `/virtual/${name}`);

  return sources;
};

const buildProgram = (sources: FixtureSources): ParsedFile[] => {
  return Object.entries(sources).map(([filePath, sourceText]) => parseSource(filePath, sourceText));
};

// ── Core runner ──────────────────────────────────────────────────────────────

/**
 * Register a single golden test case.
 *
 * @param testDir     - Pass `import.meta.dir` from the calling test file
 * @param name        - Fixture name (without extension) — used for both
 *                      `__fixtures__/<name>.ts` and `__expected__/<name>.json`
 * @param analyzerFn  - Receives (program, sources) and returns findings
 * @param opts        - Optional configuration
 */
export const runGolden = <T = unknown>(
  testDir: string,
  name: string,
  analyzerFn: AnalyzerFn<T>,
  _opts: GoldenRunOptions = {},
): void => {
  const fixturesDir = path.join(testDir, '__fixtures__');
  const expectedDir = path.join(testDir, '__expected__');

  it(`golden: ${name}`, async () => {
    // Load fixture
    const sources = readDirFixture(fixturesDir, name);
    const program = buildProgram(sources);

    // Run analyzer — use partial field when tool is unavailable (e.g. tsgo)
    let actual: unknown;

    try {
      actual = await Promise.resolve(analyzerFn(program, sources));
    } catch (e) {
      if (e instanceof PartialResultError) {
        actual = e.partial;
      } else {
        throw e;
      }
    }

    const actualJson = toGoldenJson(actual);

    const expectedJson = readExpected(expectedDir, name);

    if (expectedJson === null) {
      // First run: create the expected file and fail so the developer can review.
      writeExpected(expectedDir, name, actualJson);
      throw new Error(
        `[golden] Created new expected file for "${name}". ` +
          `Review ${path.join(expectedDir, `${name}.json`)} and re-run.`,
      );
    }

    // Compare
    const expectedParsed = JSON.parse(expectedJson.trim()) as unknown;
    const actualParsed = JSON.parse(actualJson) as unknown;

    expect(actualParsed).toEqual(expectedParsed);

    // ── Order stability (P2-19): reversed program input → same result ──────────
    if (program.length > 1) {
      let reversedActual: unknown;

      try {
        reversedActual = await Promise.resolve(analyzerFn([...program].reverse(), sources));
      } catch (e) {
        if (e instanceof PartialResultError) {
          reversedActual = e.partial;
        } else {
          throw e;
        }
      }

      // Compare as sorted JSON strings to be insensitive to finding order.
      const sortedExpected = JSON.stringify(
        Array.isArray(expectedParsed) ? [...expectedParsed as unknown[]].sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1) : expectedParsed,
        null,
        2,
      );
      const reversedNormalized = JSON.parse(toGoldenJson(reversedActual)) as unknown;
      const sortedReversed = JSON.stringify(
        Array.isArray(reversedNormalized) ? [...reversedNormalized as unknown[]].sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1) : reversedNormalized,
        null,
        2,
      );

      expect(sortedReversed).toBe(sortedExpected);
    }
  });
};

