import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ParsedFile } from '../../engine/types';

import { parseSource } from '../../engine/ast/parse-source';
import { analyzeBarrel, createEmptyBarrel } from './analyzer';

const toFile = (filePath: string, code: string): ParsedFile => parseSource(filePath, code) as ParsedFile;

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'firebat-barrel-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// Helper: cross-module-reexport 테스트용 — tmpDir 내 src 서브디렉토리 기준
// src/index.ts에서 ../other.ts를 re-export하는 패턴 테스트
// resolver가 상대경로를 fileSet 기반으로 resolve하므로 other.ts도 program에 포함해야 함
const makeSrcFile = (tmpRoot: string, relPath: string, code: string): ParsedFile => {
  return toFile(path.join(tmpRoot, relPath), code);
};

describe('analyzer', () => {
  describe('createEmptyBarrel', () => {
    it('returns empty array', () => {
      expect(createEmptyBarrel()).toEqual([]);
    });
  });

  describe('analyzeBarrel', () => {
    it('returns empty array for non-array input', async () => {
      const result = await analyzeBarrel(null as unknown as ParsedFile[], { rootAbs: tmpDir });

      expect(result).toEqual([]);
    });

    it('returns empty array for empty files list', async () => {
      const result = await analyzeBarrel([], { rootAbs: tmpDir });

      expect(result).toEqual([]);
    });

    it('returns empty array when all files are in node_modules (ignored)', async () => {
      const f = toFile(path.join(tmpDir, 'node_modules/foo/bar.ts'), `export const x = 1;`);
      const result = await analyzeBarrel([f], { rootAbs: tmpDir });

      expect(result).toEqual([]);
    });

    it('detects export * from (star export) finding', async () => {
      const srcDir = path.join(tmpDir, 'src');

      await fs.mkdir(srcDir, { recursive: true });

      const code = `export * from './other';`;
      const f = toFile(path.join(srcDir, 'barrel.ts'), code);
      const result = await analyzeBarrel([f], { rootAbs: tmpDir });
      const starFindings = result.filter(r => r.kind === 'export-star');

      expect(starFindings.length).toBeGreaterThanOrEqual(1);
    });

    it('BarrelFinding has required shape: kind, file, span', async () => {
      const srcDir = path.join(tmpDir, 'src');

      await fs.mkdir(srcDir, { recursive: true });

      const f = toFile(path.join(srcDir, 'index.ts'), `export * from './mod';`);
      const result = await analyzeBarrel([f], { rootAbs: tmpDir });

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
      const result = await analyzeBarrel([f], { rootAbs: tmpDir, ignoreGlobs: ['generated/**'] });

      expect(result).toEqual([]);
    });

    it('does not flag regular non-index .ts files without export-star', async () => {
      const srcDir = path.join(tmpDir, 'src');

      await fs.mkdir(srcDir, { recursive: true });

      const f = toFile(path.join(srcDir, 'clean.ts'), `export const foo = () => 42;`);
      const result = await analyzeBarrel([f], { rootAbs: tmpDir });

      expect(result.every(r => r.kind !== 'export-star')).toBe(true);
    });

    it('should ignore files in test directories by default', async () => {
      const testDir = path.join(tmpDir, 'test', 'unit');

      await fs.mkdir(testDir, { recursive: true });

      const testsDir = path.join(tmpDir, '__tests__', 'integration');

      await fs.mkdir(testsDir, { recursive: true });

      const f1 = toFile(path.join(testDir, 'foo.ts'), `export * from './bar';`);
      const f2 = toFile(path.join(testsDir, 'baz.ts'), `export * from './qux';`);
      const result = await analyzeBarrel([f1, f2], { rootAbs: tmpDir });

      expect(result).toEqual([]);
    });

    it('should ignore spec and test files by default', async () => {
      const srcDir = path.join(tmpDir, 'src');

      await fs.mkdir(srcDir, { recursive: true });

      const f1 = toFile(path.join(srcDir, 'foo.spec.ts'), `export * from './bar';`);
      const f2 = toFile(path.join(srcDir, 'bar.test.ts'), `export * from './baz';`);
      const result = await analyzeBarrel([f1, f2], { rootAbs: tmpDir });

      expect(result).toEqual([]);
    });
  });

  // ─── cross-module-reexport: 구문 A (export from) ───────────────────────────

  describe('checkCrossModuleReexport — syntax A: export from', () => {
    it('export { X } from "../other" — cross-module — detects finding', async () => {
      const srcDir = path.join(tmpDir, 'src');

      await fs.mkdir(srcDir, { recursive: true });

      const indexFile = makeSrcFile(tmpDir, 'src/index.ts', `export { X } from '../other';`);
      const otherFile = makeSrcFile(tmpDir, 'other.ts', `export const X = 1;`);
      const result = await analyzeBarrel([indexFile, otherFile], { rootAbs: tmpDir });
      const findings = result.filter(r => r.kind === 'cross-module-reexport');

      expect(findings.length).toBeGreaterThanOrEqual(1);
      expect(findings[0]?.file).toContain('src/index.ts');
    });

    it('export type { X } from "../other" — cross-module — detects finding', async () => {
      const srcDir = path.join(tmpDir, 'src');

      await fs.mkdir(srcDir, { recursive: true });

      const indexFile = makeSrcFile(tmpDir, 'src/index.ts', `export type { X } from '../other';`);
      const otherFile = makeSrcFile(tmpDir, 'other.ts', `export type X = string;`);
      const result = await analyzeBarrel([indexFile, otherFile], { rootAbs: tmpDir });
      const findings = result.filter(r => r.kind === 'cross-module-reexport');

      expect(findings.length).toBeGreaterThanOrEqual(1);
    });

    it('export * from "../other" — cross-module — detects finding', async () => {
      const srcDir = path.join(tmpDir, 'src');

      await fs.mkdir(srcDir, { recursive: true });

      const indexFile = makeSrcFile(tmpDir, 'src/index.ts', `export * from '../other';`);
      const otherFile = makeSrcFile(tmpDir, 'other.ts', `export const X = 1;`);
      const result = await analyzeBarrel([indexFile, otherFile], { rootAbs: tmpDir });
      const findings = result.filter(r => r.kind === 'cross-module-reexport');

      expect(findings.length).toBeGreaterThanOrEqual(1);
    });

    it('export { X } from "./child" — child path — allowed, no finding', async () => {
      const childDir = path.join(tmpDir, 'src', 'child');

      await fs.mkdir(childDir, { recursive: true });

      const indexFile = makeSrcFile(tmpDir, 'src/index.ts', `export { X } from './child/mod';`);
      const childFile = makeSrcFile(tmpDir, 'src/child/mod.ts', `export const X = 1;`);
      const result = await analyzeBarrel([indexFile, childFile], { rootAbs: tmpDir });
      const findings = result.filter(r => r.kind === 'cross-module-reexport');

      expect(findings.length).toBe(0);
    });

    it('export { X as Y } from "../other" — rename — still detects finding', async () => {
      const srcDir = path.join(tmpDir, 'src');

      await fs.mkdir(srcDir, { recursive: true });

      const indexFile = makeSrcFile(tmpDir, 'src/index.ts', `export { X as Y } from '../other';`);
      const otherFile = makeSrcFile(tmpDir, 'other.ts', `export const X = 1;`);
      const result = await analyzeBarrel([indexFile, otherFile], { rootAbs: tmpDir });
      const findings = result.filter(r => r.kind === 'cross-module-reexport');

      expect(findings.length).toBeGreaterThanOrEqual(1);
    });

    it('export { X } from "lodash" — bare specifier — allowed, no finding', async () => {
      const srcDir = path.join(tmpDir, 'src');

      await fs.mkdir(srcDir, { recursive: true });

      const indexFile = makeSrcFile(tmpDir, 'src/index.ts', `export { X } from 'lodash';`);
      const result = await analyzeBarrel([indexFile], { rootAbs: tmpDir });
      const findings = result.filter(r => r.kind === 'cross-module-reexport');

      expect(findings.length).toBe(0);
    });
  });

  // ─── cross-module-reexport: 구문 B (import + export) ─────────────────────

  describe('checkCrossModuleReexport — syntax B: import + export', () => {
    it('import { X } from "../other"; export { X } — X not used locally — detects finding', async () => {
      const srcDir = path.join(tmpDir, 'src');

      await fs.mkdir(srcDir, { recursive: true });

      const indexFile = makeSrcFile(
        tmpDir,
        'src/index.ts',
        `import { X } from '../other';
export { X };`,
      );
      const otherFile = makeSrcFile(tmpDir, 'other.ts', `export const X = 1;`);
      const result = await analyzeBarrel([indexFile, otherFile], { rootAbs: tmpDir });
      const findings = result.filter(r => r.kind === 'cross-module-reexport');

      expect(findings.length).toBeGreaterThanOrEqual(1);
    });

    it('import { X } from "../other"; export { X } — X used locally — allowed', async () => {
      const srcDir = path.join(tmpDir, 'src');

      await fs.mkdir(srcDir, { recursive: true });

      const indexFile = makeSrcFile(
        tmpDir,
        'src/index.ts',
        `import { X } from '../other';
const local: X = {};
export { X };`,
      );
      const otherFile = makeSrcFile(tmpDir, 'other.ts', `export const X = 1;`);
      const result = await analyzeBarrel([indexFile, otherFile], { rootAbs: tmpDir });
      const findings = result.filter(r => r.kind === 'cross-module-reexport');

      expect(findings.length).toBe(0);
    });

    it('import { X } from "./child/mod"; export { X } — child path — allowed', async () => {
      const childDir = path.join(tmpDir, 'src', 'child');

      await fs.mkdir(childDir, { recursive: true });

      const indexFile = makeSrcFile(tmpDir, 'src/index.ts', `import { X } from './child/mod'; export { X };`);
      const childFile = makeSrcFile(tmpDir, 'src/child/mod.ts', `export const X = 1;`);
      const result = await analyzeBarrel([indexFile, childFile], { rootAbs: tmpDir });
      const findings = result.filter(r => r.kind === 'cross-module-reexport');

      expect(findings.length).toBe(0);
    });

    it('import { X } from "lodash"; export { X } — bare specifier — allowed', async () => {
      const srcDir = path.join(tmpDir, 'src');

      await fs.mkdir(srcDir, { recursive: true });

      const indexFile = makeSrcFile(tmpDir, 'src/index.ts', `import { X } from 'lodash'; export { X };`);
      const result = await analyzeBarrel([indexFile], { rootAbs: tmpDir });
      const findings = result.filter(r => r.kind === 'cross-module-reexport');

      expect(findings.length).toBe(0);
    });

    it('import type { X } from "../other"; export type { X } — X not used locally — detects finding', async () => {
      const srcDir = path.join(tmpDir, 'src');

      await fs.mkdir(srcDir, { recursive: true });

      const indexFile = makeSrcFile(
        tmpDir,
        'src/index.ts',
        `import type { X } from '../other';
export type { X };`,
      );
      const otherFile = makeSrcFile(tmpDir, 'other.ts', `export type X = string;`);
      const result = await analyzeBarrel([indexFile, otherFile], { rootAbs: tmpDir });
      const findings = result.filter(r => r.kind === 'cross-module-reexport');

      expect(findings.length).toBeGreaterThanOrEqual(1);
    });

    it('import { X, Y } from "../other"; export { X } — X unused, Y used — detects X only', async () => {
      const srcDir = path.join(tmpDir, 'src');

      await fs.mkdir(srcDir, { recursive: true });

      const indexFile = makeSrcFile(
        tmpDir,
        'src/index.ts',
        `import { X, Y } from '../other';
const val: Y = {};
export { X };`,
      );
      const otherFile = makeSrcFile(tmpDir, 'other.ts', `export const X = 1; export type Y = string;`);
      const result = await analyzeBarrel([indexFile, otherFile], { rootAbs: tmpDir });
      const findings = result.filter(r => r.kind === 'cross-module-reexport');

      expect(findings.length).toBe(1);
      expect(findings[0]?.file).toContain('src/index.ts');
    });

    it('block scope shadow — import X used after block — allowed', async () => {
      const srcDir = path.join(tmpDir, 'src');

      await fs.mkdir(srcDir, { recursive: true });

      const indexFile = makeSrcFile(
        tmpDir,
        'src/index.ts',
        `import { X } from '../other';
{ const X = 1; }
const val: X = {};
export { X };`,
      );
      const otherFile = makeSrcFile(tmpDir, 'other.ts', `export const X = 1;`);
      const result = await analyzeBarrel([indexFile, otherFile], { rootAbs: tmpDir });
      const findings = result.filter(r => r.kind === 'cross-module-reexport');

      expect(findings.length).toBe(0);
    });

    it('shadow: import { X } from "../other"; function foo() { const X = 1; use(X); } export { X } — detects finding', async () => {
      const srcDir = path.join(tmpDir, 'src');

      await fs.mkdir(srcDir, { recursive: true });

      const indexFile = makeSrcFile(
        tmpDir,
        'src/index.ts',
        `import { X } from '../other';
function foo() { const X = 1; return X; }
export { X };`,
      );
      const otherFile = makeSrcFile(tmpDir, 'other.ts', `export const X = 1;`);
      const result = await analyzeBarrel([indexFile, otherFile], { rootAbs: tmpDir });
      const findings = result.filter(r => r.kind === 'cross-module-reexport');

      expect(findings.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── cross-module-reexport: 구문 C (import + export default) ─────────────

  describe('checkCrossModuleReexport — syntax C: import + export default', () => {
    it('import X from "../other"; export default X — X not used locally — detects finding', async () => {
      const srcDir = path.join(tmpDir, 'src');

      await fs.mkdir(srcDir, { recursive: true });

      const indexFile = makeSrcFile(
        tmpDir,
        'src/index.ts',
        `import X from '../other';
export default X;`,
      );
      const otherFile = makeSrcFile(tmpDir, 'other.ts', `export default class X {}`);
      const result = await analyzeBarrel([indexFile, otherFile], { rootAbs: tmpDir });
      const findings = result.filter(r => r.kind === 'cross-module-reexport');

      expect(findings.length).toBeGreaterThanOrEqual(1);
    });

    it('import X from "../other"; export default X — X used locally — allowed', async () => {
      const srcDir = path.join(tmpDir, 'src');

      await fs.mkdir(srcDir, { recursive: true });

      const indexFile = makeSrcFile(
        tmpDir,
        'src/index.ts',
        `import X from '../other';
const inst = new X();
export default X;`,
      );
      const otherFile = makeSrcFile(tmpDir, 'other.ts', `export default class X {}`);
      const result = await analyzeBarrel([indexFile, otherFile], { rootAbs: tmpDir });
      const findings = result.filter(r => r.kind === 'cross-module-reexport');

      expect(findings.length).toBe(0);
    });

    it('import X from "../other"; export default new X() — transformation — allowed', async () => {
      const srcDir = path.join(tmpDir, 'src');

      await fs.mkdir(srcDir, { recursive: true });

      const indexFile = makeSrcFile(
        tmpDir,
        'src/index.ts',
        `import X from '../other';
export default new X();`,
      );
      const otherFile = makeSrcFile(tmpDir, 'other.ts', `export default class X {}`);
      const result = await analyzeBarrel([indexFile, otherFile], { rootAbs: tmpDir });
      const findings = result.filter(r => r.kind === 'cross-module-reexport');

      expect(findings.length).toBe(0);
    });

    it('import X from "./child/mod"; export default X — child path — allowed', async () => {
      const childDir = path.join(tmpDir, 'src', 'child');

      await fs.mkdir(childDir, { recursive: true });

      const indexFile = makeSrcFile(
        tmpDir,
        'src/index.ts',
        `import X from './child/mod';
export default X;`,
      );
      const childFile = makeSrcFile(tmpDir, 'src/child/mod.ts', `export default class X {}`);
      const result = await analyzeBarrel([indexFile, childFile], { rootAbs: tmpDir });
      const findings = result.filter(r => r.kind === 'cross-module-reexport');

      expect(findings.length).toBe(0);
    });
  });
});
