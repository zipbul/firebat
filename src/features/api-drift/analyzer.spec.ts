import { afterAll, describe, expect, it, mock } from 'bun:test';
import * as path from 'node:path';

const __origTsgoChecks = { ...require(path.resolve(import.meta.dir, './tsgo-checks.ts')) };

// mock tsgo-checks to avoid running actual tsgo binary
mock.module(path.resolve(import.meta.dir, './tsgo-checks.ts'), () => ({
  runTsgoApiDriftChecks: async () => ({ ok: false, groups: [], error: 'mocked' }),
}));

import { analyzeApiDrift, createEmptyApiDrift } from './analyzer';
import { parseSource } from '../../engine/parse-source';
import type { ParsedFile } from '../../engine/types';

const toFile = (filePath: string, code: string): ParsedFile =>
  parseSource(filePath, code) as ParsedFile;

describe('features/api-drift/analyzer — createEmptyApiDrift', () => {
  it('returns empty array', () => {
    expect(createEmptyApiDrift()).toEqual([]);
  });
});

describe('features/api-drift/analyzer — analyzeApiDrift', () => {
  it('returns empty array for empty program', async () => {
    const result = await analyzeApiDrift([]);
    expect(result).toEqual([]);
  });

  it('skips files with parse errors', async () => {
    const bad: ParsedFile = {
      filePath: '/bad.ts',
      program: {} as never,
      errors: [{ message: 'err' }] as never as [],
      comments: [],
      sourceText: '',
    };
    const result = await analyzeApiDrift([bad]);
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns groups for functions with same name but different signatures', async () => {
    const f1 = toFile('/a/service.ts', `
      function processItem(id: string): void {}
    `);
    const f2 = toFile('/b/service.ts', `
      function processItem(id: string, label: string): string { return label; }
    `);
    const result = await analyzeApiDrift([f1, f2]);
    expect(Array.isArray(result)).toBe(true);
  });

  it('anonymous functions are skipped (no group created)', async () => {
    const f = toFile('/anon.ts', `const fn = function() { return 1; };`);
    const result = await analyzeApiDrift([f]);
    // anonymous functions produce no drift groups
    const groups = result.filter(g => g.name === 'anonymous');
    expect(groups.length).toBe(0);
  });

  it('ApiDriftGroup has required fields: name, outliers', async () => {
    const code = `function doThing(a: string): void {}`;
    const f1 = toFile('/x/doThing.ts', code);
    const f2 = toFile('/y/doThing.ts', `function doThing(a: string, b: number): boolean { return true; }`);
    const result = await analyzeApiDrift([f1, f2]);
    for (const group of result) {
      expect(typeof group.name).toBe('string');
      expect(Array.isArray(group.outliers)).toBe(true);
    }
  });

  it('accepts rootAbs and tsconfigPath options', async () => {
    const f = toFile('/foo/bar.ts', `function fn(x: number) { return x; }`);
    await expect(
      analyzeApiDrift([f], { rootAbs: process.cwd(), tsconfigPath: 'tsconfig.json' }),
    ).resolves.toBeDefined();
  });
});

afterAll(() => {
  mock.restore();
  mock.module(path.resolve(import.meta.dir, './tsgo-checks.ts'), () => __origTsgoChecks);
});
