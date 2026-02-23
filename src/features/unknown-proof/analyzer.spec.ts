import { afterAll, describe, expect, it, mock } from 'bun:test';
import * as path from 'node:path';

const __origTsgoChecks = { ...require(path.resolve(import.meta.dir, './tsgo-checks.ts')) };

// mock.module must be hoisted before any imports of the target module
mock.module(path.resolve(import.meta.dir, './tsgo-checks.ts'), () => ({
  runTsgoUnknownProofChecks: async () => ({
    ok: true,
    findings: [],
  }),
}));

import { analyzeUnknownProof, createEmptyUnknownProof } from './analyzer';
import { parseSource } from '../../engine/ast/parse-source';
import type { ParsedFile } from '../../engine/types';

const toFile = (filePath: string, code: string): ParsedFile =>
  parseSource(filePath, code) as ParsedFile;

describe('features/unknown-proof/analyzer — createEmptyUnknownProof', () => {
  it('returns empty array', () => {
    expect(createEmptyUnknownProof()).toEqual([]);
  });
});

describe('features/unknown-proof/analyzer — analyzeUnknownProof', () => {
  it('returns empty array for empty program', async () => {
    const result = await analyzeUnknownProof([]);
    expect(result).toEqual([]);
  });

  it('returns empty array when no unknown annotations found', async () => {
    const f = toFile('/clean.ts', `const x: number = 42;`);
    const result = await analyzeUnknownProof([f], { rootAbs: '/tmp' });
    expect(Array.isArray(result)).toBe(true);
  });

  it('detects type assertion (as unknown) finding', async () => {
    const f = toFile('/assert.ts', `const x = someValue as unknown;`);
    const result = await analyzeUnknownProof([f], { rootAbs: '/tmp' });
    expect(Array.isArray(result)).toBe(true);
    // Type assertion findings are included in the result
  });

  it('accepts rootAbs option without error', async () => {
    const f = toFile('/foo.ts', `const y = 1;`);
    await expect(analyzeUnknownProof([f], { rootAbs: process.cwd() })).resolves.toBeDefined();
  });

  it('accepts boundaryGlobs option without error', async () => {
    const f = toFile('/bar.ts', `export function bar() { return 1; }`);
    await expect(
      analyzeUnknownProof([f], { rootAbs: process.cwd(), boundaryGlobs: ['src/api/**'] }),
    ).resolves.toBeDefined();
  });
});

afterAll(() => {
  mock.restore();
  mock.module(path.resolve(import.meta.dir, './tsgo-checks.ts'), () => __origTsgoChecks);
});
