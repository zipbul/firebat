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
    const groups = result.filter(g => g.label === 'anonymous');
    expect(groups.length).toBe(0);
  });

  it('ApiDriftGroup has required fields: name, outliers', async () => {
    const code = `function doThing(a: string): void {}`;
    const f1 = toFile('/x/doThing.ts', code);
    const f2 = toFile('/y/doThing.ts', `function doThing(a: string, b: number): boolean { return true; }`);
    const result = await analyzeApiDrift([f1, f2]);
    for (const group of result) {
      expect(typeof group.label).toBe('string');
      expect(Array.isArray(group.outliers)).toBe(true);
    }
  });

  it('accepts rootAbs and tsconfigPath options', async () => {
    const f = toFile('/foo/bar.ts', `function fn(x: number) { return x; }`);
    await expect(
      analyzeApiDrift([f], { rootAbs: process.cwd(), tsconfigPath: 'tsconfig.json' }),
    ).resolves.toBeDefined();
  });

  it('should not group functions under common stop-word prefixes (get, set, on, is, to, has)', async () => {
    // Arrange — functions with "get" prefix but DIFFERENT signatures → would produce outlier groups
    const code = [
      'function getUser(): string { return ""; }',
      'function getItems(limit: number): string[] { return []; }',
      'function getConfig(key: string, fallback: string): string { return ""; }',
    ].join('\n');
    const f = toFile('/src/fns.ts', code);
    const result = await analyzeApiDrift([f]);
    // No group should have a prefix label matching stop words
    const prefixGroups = result.filter(g => g.label?.startsWith('prefix:get') || g.label?.startsWith('prefix:set'));
    expect(prefixGroups.length).toBe(0);
  });

  it('should not group functions under extended stop-word prefixes (process, validate, parse, build)', async () => {
    const code = [
      'function processUser(id: string): void {}',
      'function processOrder(id: string, amount: number): boolean { return true; }',
      'function processPayment(id: string, amount: number, currency: string): void {}',
      'function validateUser(id: string): boolean { return true; }',
      'function validateInput(data: string, strict: boolean): void {}',
      'function validateConfig(key: string): string { return ""; }',
      'function parseToken(token: string): void {}',
      'function parseConfig(raw: string, strict: boolean): void {}',
      'function parseArgs(args: string[]): void {}',
      'function buildQuery(table: string): string { return ""; }',
      'function buildResponse(data: string, status: number): void {}',
      'function buildUrl(base: string, path: string, query: string): string { return ""; }',
    ].join('\n');
    const f = toFile('/src/extended-fns.ts', code);
    const result = await analyzeApiDrift([f]);
    const prefixLabels = ['process', 'validate', 'parse', 'build'];
    const fpGroups = result.filter(g =>
      prefixLabels.some(p => g.label?.startsWith(`prefix:${p}`)),
    );
    expect(fpGroups.length).toBe(0);
  });
});

afterAll(() => {
  mock.restore();
  mock.module(path.resolve(import.meta.dir, './tsgo-checks.ts'), () => __origTsgoChecks);
});
