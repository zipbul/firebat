import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { analyzeBarrelPolicy, createEmptyBarrelPolicy } from './analyzer';
import { parseSource } from '../../engine/parse-source';
import type { ParsedFile } from '../../engine/types';

const toFile = (filePath: string, code: string): ParsedFile =>
  parseSource(filePath, code) as ParsedFile;

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'firebat-barrel-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('features/barrel-policy/analyzer — createEmptyBarrelPolicy', () => {
  it('returns empty array', () => {
    expect(createEmptyBarrelPolicy()).toEqual([]);
  });
});

describe('features/barrel-policy/analyzer — analyzeBarrelPolicy', () => {
  it('returns empty array for non-array input', async () => {
    const result = await analyzeBarrelPolicy(null as unknown as ParsedFile[], { rootAbs: tmpDir });
    expect(result).toEqual([]);
  });

  it('returns empty array for empty files list', async () => {
    const result = await analyzeBarrelPolicy([], { rootAbs: tmpDir });
    expect(result).toEqual([]);
  });

  it('returns empty array when all files are in node_modules (ignored)', async () => {
    const f = toFile(path.join(tmpDir, 'node_modules/foo/bar.ts'), `export const x = 1;`);
    const result = await analyzeBarrelPolicy([f], { rootAbs: tmpDir });
    expect(result).toEqual([]);
  });

  it('detects export * from (star export) finding', async () => {
    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    const code = `export * from './other';`;
    const f = toFile(path.join(srcDir, 'barrel.ts'), code);
    const result = await analyzeBarrelPolicy([f], { rootAbs: tmpDir });
    const starFindings = result.filter(r => r.kind === 'export-star');
    expect(starFindings.length).toBeGreaterThanOrEqual(1);
  });

  it('BarrelPolicyFinding has required shape: kind, file, span', async () => {
    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    const f = toFile(path.join(srcDir, 'index.ts'), `export * from './mod';`);
    const result = await analyzeBarrelPolicy([f], { rootAbs: tmpDir });
    for (const finding of result) {
      expect(typeof finding.kind).toBe('string');
      expect(typeof finding.file).toBe('string');
      expect(finding.span).toBeDefined();
    }
  });

  it('respects ignoreGlobs option to skip specific paths', async () => {
    const srcDir = path.join(tmpDir, 'generated');
    await fs.mkdir(srcDir, { recursive: true });
    const f = toFile(path.join(srcDir, 'barrel.ts'), `export * from './other';`);
    // Ignore the generated/* glob
    const result = await analyzeBarrelPolicy([f], { rootAbs: tmpDir, ignoreGlobs: ['generated/**'] });
    expect(result).toEqual([]);
  });

  it('does not flag regular non-index .ts files without export-star', async () => {
    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    const f = toFile(path.join(srcDir, 'clean.ts'), `export const foo = () => 42;`);
    const result = await analyzeBarrelPolicy([f], { rootAbs: tmpDir });
    expect(result.every(r => r.kind !== 'export-star')).toBe(true);
  });

  it('should ignore files in test directories by default', async () => {
    const testDir = path.join(tmpDir, 'test', 'unit');
    await fs.mkdir(testDir, { recursive: true });
    const testsDir = path.join(tmpDir, '__tests__', 'integration');
    await fs.mkdir(testsDir, { recursive: true });

    const f1 = toFile(path.join(testDir, 'foo.ts'), `export * from './bar';`);
    const f2 = toFile(path.join(testsDir, 'baz.ts'), `export * from './qux';`);

    const result = await analyzeBarrelPolicy([f1, f2], { rootAbs: tmpDir });

    expect(result).toEqual([]);
  });

  it('should ignore spec and test files by default', async () => {
    const srcDir = path.join(tmpDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });

    const f1 = toFile(path.join(srcDir, 'foo.spec.ts'), `export * from './bar';`);
    const f2 = toFile(path.join(srcDir, 'bar.test.ts'), `export * from './baz';`);

    const result = await analyzeBarrelPolicy([f1, f2], { rootAbs: tmpDir });

    expect(result).toEqual([]);
  });
});
