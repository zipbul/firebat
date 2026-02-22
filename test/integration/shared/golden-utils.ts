/**
 * Shared utilities for golden test runners.
 *
 * Both golden-runner.ts (detector analyzer) and oxlint-golden-runner.ts (oxlint
 * plugin) share identical serialization & I/O helpers. This module is the
 * single source of truth for those helpers to prevent drift between the two
 * runners.
 */
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
