/**
 * Shared utilities for golden test runners.
 *
 * Both golden-runner.ts (detector analyzer) and oxlint-golden-runner.ts (oxlint
 * plugin) share identical serialization & I/O helpers. This module is the
 * single source of truth for those helpers to prevent drift between the two
 * runners.
 */
import { expect } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ── Serialization ────────────────────────────────────────────────────────────

/**
 * Recursively normalize a value for golden comparison:
 *  - Sort object keys alphabetically for stable JSON output
 *  - Recurse into arrays and nested objects
 *  - `undefined` fields are omitted by `JSON.stringify` (intentional — keeps
 *    expected files free of null noise)
 */
export const normalizeValue = (value: unknown): unknown => {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};

    for (const key of Object.keys(obj).sort()) {
      sorted[key] = normalizeValue(obj[key]);
    }

    return sorted;
  }

  return value;
};

export const toGoldenJson = (actual: unknown): string => {
  return JSON.stringify(normalizeValue(actual), null, 2);
};

/** Resolve `${fixturesDir}/${name}.ts`, throwing if the fixture file is absent. */
export const resolveFixturePath = (fixturesDir: string, name: string): string => {
  const p = path.join(fixturesDir, `${name}.ts`);

  if (!fs.existsSync(p)) {
    throw new Error(`Fixture not found: ${p}`);
  }

  return p;
};

// ── Expected file I/O ────────────────────────────────────────────────────────

export const readExpected = (expectedDir: string, name: string): string | null => {
  const expectedPath = path.join(expectedDir, `${name}.json`);

  if (!fs.existsSync(expectedPath)) {
    return null;
  }

  return fs.readFileSync(expectedPath, 'utf8');
};

export const writeExpected = (expectedDir: string, name: string, json: string): void => {
  fs.mkdirSync(expectedDir, { recursive: true });
  fs.writeFileSync(path.join(expectedDir, `${name}.json`), `${json}\n`, 'utf8');
};

// ── Golden comparison ────────────────────────────────────────────────────────

export interface GoldenComparison {
  expectedParsed: unknown;
  actualParsed: unknown;
}

/**
 * Serialize `actual`, compare it against the stored expected file, and assert
 * equality. On the first run (no expected file) the expected file is written and
 * the test fails so the developer can review it. Returns the parsed expected and
 * actual values for any follow-up assertions (e.g. order-stability checks).
 *
 * Both golden runners share this read/first-run-write/compare decision; routing
 * them through one helper keeps that contract in a single place.
 */
export const compareGolden = (expectedDir: string, name: string, actual: unknown): GoldenComparison => {
  const actualJson = toGoldenJson(actual);
  const expectedJson = readExpected(expectedDir, name);

  if (expectedJson === null) {
    writeExpected(expectedDir, name, actualJson);

    throw new Error(
      `[golden] Created new expected file for "${name}". Review ${path.join(expectedDir, `${name}.json`)} and re-run.`,
    );
  }

  const expectedParsed = JSON.parse(expectedJson.trim()) as unknown;
  const actualParsed = JSON.parse(actualJson) as unknown;

  expect(actualParsed).toEqual(expectedParsed);

  return { expectedParsed, actualParsed };
};
