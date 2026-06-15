import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ParsedFile } from '../../engine/types';

import { parseFileAs as toFile } from '../../../test/integration/shared/test-kit';
import { analyzeBarrel, createEmptyBarrel } from './analyzer';

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

interface SrcFile {
  rel: string;
  code: string;
}

interface ReexportCase {
  name: string;
  files: ReadonlyArray<SrcFile>;
  dirs: ReadonlyArray<string>;
  expected: number;
}

interface ReexportFileCase extends ReexportCase {
  fileContains: string;
}

interface GildashReexportCase extends ReexportCase {
  gildash: () => unknown;
}

interface EmptyResultCase {
  name: string;
  files: ReadonlyArray<SrcFile>;
  dirs: ReadonlyArray<string>;
  ignoreGlobs?: ReadonlyArray<string>;
  expected: ReadonlyArray<never>;
}

interface StarFindingCase {
  name: string;
  file: SrcFile;
  dir: string;
  ignoreGlobs?: ReadonlyArray<string>;
}

// Build analyzeBarrel options, omitting optional keys that are undefined so the
// call stays compatible with exactOptionalPropertyTypes. Conditional logic lives
// here (a helper) so it.each callback bodies stay conditional-free.
const makeOpts = (ignoreGlobs?: ReadonlyArray<string>, gildash?: unknown) => {
  const opts: { rootAbs: string; ignoreGlobs?: ReadonlyArray<string>; gildash?: never } = { rootAbs: tmpDir };

  if (ignoreGlobs !== undefined) {
    opts.ignoreGlobs = ignoreGlobs;
  }

  if (gildash !== undefined) {
    opts.gildash = gildash as never;
  }

  return opts;
};

// Shared harness for cross-module-reexport cases: mkdir each dir, build the
// source files, run analyzeBarrel, return the cross-module-reexport findings.
const runReexport = async (c: ReexportCase, gildash?: unknown) => {
  for (const dir of c.dirs) {
    await fs.mkdir(path.join(tmpDir, dir), { recursive: true });
  }

  const files = c.files.map(f => makeSrcFile(tmpDir, f.rel, f.code));
  const result = await analyzeBarrel(files, makeOpts(undefined, gildash));

  return result.filter(r => r.kind === 'cross-module-reexport');
};

describe('analyzer', () => {
  describe('createEmptyBarrel', () => {
    it('returns empty array', () => {
      expect(createEmptyBarrel()).toEqual([]);
    });
  });

  describe('analyzeBarrel', () => {
    // Each row builds zero or more files, runs analyzeBarrel with optional
    // ignoreGlobs, and asserts the whole result is empty (ignored/no-finding paths).
    const emptyCases: EmptyResultCase[] = [
      {
        name: 'returns empty array for empty files list',
        files: [],
        dirs: [],
        expected: [],
      },
      {
        name: 'returns empty array when all files are in node_modules (ignored)',
        files: [{ rel: 'node_modules/foo/bar.ts', code: `export const x = 1;` }],
        dirs: [],
        expected: [],
      },
      {
        name: 'respects ignoreGlobs option to skip specific paths',
        files: [{ rel: 'generated/barrel.ts', code: `export * from './other';` }],
        dirs: ['generated'],
        ignoreGlobs: ['generated/**'],
        expected: [],
      },
      {
        name: 'should ignore files in test directories by default',
        files: [
          { rel: 'test/unit/foo.ts', code: `export * from './bar';` },
          { rel: '__tests__/integration/baz.ts', code: `export * from './qux';` },
        ],
        dirs: ['test/unit', '__tests__/integration'],
        expected: [],
      },
      {
        name: 'should ignore spec and test files by default',
        files: [
          { rel: 'src/foo.spec.ts', code: `export * from './bar';` },
          { rel: 'src/bar.test.ts', code: `export * from './baz';` },
        ],
        dirs: ['src'],
        expected: [],
      },
    ];

    it.each(emptyCases)('$name', async c => {
      for (const dir of c.dirs) {
        await fs.mkdir(path.join(tmpDir, dir), { recursive: true });
      }

      const files = c.files.map(f => toFile(path.join(tmpDir, f.rel), f.code));
      const result = await analyzeBarrel(files, makeOpts(c.ignoreGlobs));

      expect(result).toEqual(c.expected);
    });

    it('returns empty array for non-array input', async () => {
      const result = await analyzeBarrel(null as unknown as ParsedFile[], { rootAbs: tmpDir });

      expect(result).toEqual([]);
    });

    // Each row builds a single file and asserts exactly one export-star finding.
    const starCases: StarFindingCase[] = [
      {
        name: 'detects export * from (star export) finding',
        file: { rel: 'src/barrel.ts', code: `export * from './other';` },
        dir: 'src',
      },
      {
        name: 'custom ignoreGlobs replaces defaults — dist files are detected',
        file: { rel: 'dist/index.ts', code: `export * from './other';` },
        dir: 'dist',
        ignoreGlobs: ['generated/**'],
      },
    ];

    it.each(starCases)('$name', async c => {
      await fs.mkdir(path.join(tmpDir, c.dir), { recursive: true });

      const f = toFile(path.join(tmpDir, c.file.rel), c.file.code);
      const result = await analyzeBarrel([f], makeOpts(c.ignoreGlobs));
      const starFindings = result.filter(r => r.kind === 'export-star');

      expect(starFindings.length).toBe(1);
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

    it('does not flag regular non-index .ts files without export-star', async () => {
      const srcDir = path.join(tmpDir, 'src');

      await fs.mkdir(srcDir, { recursive: true });

      const f = toFile(path.join(srcDir, 'clean.ts'), `export const foo = () => 42;`);
      const result = await analyzeBarrel([f], { rootAbs: tmpDir });

      expect(result.every(r => r.kind !== 'export-star')).toBe(true);
    });
  });

  // ─── cross-module-reexport: 구문 A (export from) ───────────────────────────

  describe('checkCrossModuleReexport — syntax A: export from', () => {
    const fileCases: ReexportFileCase[] = [
      {
        name: 'export { X } from "../other" — cross-module — detects finding + file',
        files: [
          { rel: 'src/index.ts', code: `export { X } from '../other';` },
          { rel: 'other.ts', code: `export const X = 1;` },
        ],
        dirs: ['src'],
        expected: 1,
        fileContains: 'src/index.ts',
      },
    ];

    it.each(fileCases)('$name', async c => {
      const findings = await runReexport(c);

      expect(findings.length).toBe(c.expected);
      expect(findings[0]?.file).toContain(c.fileContains);
    });

    const cases: ReexportCase[] = [
      {
        name: 'export type { X } from "../other" — cross-module — detects finding',
        files: [
          { rel: 'src/index.ts', code: `export type { X } from '../other';` },
          { rel: 'other.ts', code: `export type X = string;` },
        ],
        dirs: ['src'],
        expected: 1,
      },
      {
        name: 'export * from "../other" — cross-module — detects finding',
        files: [
          { rel: 'src/index.ts', code: `export * from '../other';` },
          { rel: 'other.ts', code: `export const X = 1;` },
        ],
        dirs: ['src'],
        expected: 1,
      },
      {
        name: 'export { X } from "./child" — child path — allowed, no finding',
        files: [
          { rel: 'src/index.ts', code: `export { X } from './child/mod';` },
          { rel: 'src/child/mod.ts', code: `export const X = 1;` },
        ],
        dirs: ['src/child'],
        expected: 0,
      },
      {
        name: 'export { X as Y } from "../other" — rename — still detects finding',
        files: [
          { rel: 'src/index.ts', code: `export { X as Y } from '../other';` },
          { rel: 'other.ts', code: `export const X = 1;` },
        ],
        dirs: ['src'],
        expected: 1,
      },
      {
        name: 'export { X } from "lodash" — bare specifier — allowed, no finding',
        files: [{ rel: 'src/index.ts', code: `export { X } from 'lodash';` }],
        dirs: ['src'],
        expected: 0,
      },
    ];

    it.each(cases)('$name', async c => {
      const findings = await runReexport(c);

      expect(findings.length).toBe(c.expected);
    });
  });

  // ─── cross-module-reexport: 구문 B (import + export) ─────────────────────

  describe('checkCrossModuleReexport — syntax B: import + export', () => {
    const fileCases: ReexportFileCase[] = [
      {
        name: 'import { X, Y } from "../other"; export { X } — X unused, Y used — detects X only + file',
        files: [
          {
            rel: 'src/index.ts',
            code: `import { X, Y } from '../other';
const val: Y = {};
export { X };`,
          },
          { rel: 'other.ts', code: `export const X = 1; export type Y = string;` },
        ],
        dirs: ['src'],
        expected: 1,
        fileContains: 'src/index.ts',
      },
    ];

    it.each(fileCases)('$name', async c => {
      const findings = await runReexport(c);

      expect(findings.length).toBe(c.expected);
      expect(findings[0]?.file).toContain(c.fileContains);
    });

    const cases: ReexportCase[] = [
      {
        name: 'import { X } from "../other"; export { X } — X not used locally — detects finding',
        files: [
          {
            rel: 'src/index.ts',
            code: `import { X } from '../other';
export { X };`,
          },
          { rel: 'other.ts', code: `export const X = 1;` },
        ],
        dirs: ['src'],
        expected: 1,
      },
      {
        name: 'import { X } from "../other"; export { X } — X used locally — allowed',
        files: [
          {
            rel: 'src/index.ts',
            code: `import { X } from '../other';
const local: X = {};
export { X };`,
          },
          { rel: 'other.ts', code: `export const X = 1;` },
        ],
        dirs: ['src'],
        expected: 0,
      },
      {
        name: 'import { X } from "./child/mod"; export { X } — child path — allowed',
        files: [
          { rel: 'src/index.ts', code: `import { X } from './child/mod'; export { X };` },
          { rel: 'src/child/mod.ts', code: `export const X = 1;` },
        ],
        dirs: ['src/child'],
        expected: 0,
      },
      {
        name: 'import { X } from "lodash"; export { X } — bare specifier — allowed',
        files: [{ rel: 'src/index.ts', code: `import { X } from 'lodash'; export { X };` }],
        dirs: ['src'],
        expected: 0,
      },
      {
        name: 'import type { X } from "../other"; export type { X } — X not used locally — detects finding',
        files: [
          {
            rel: 'src/index.ts',
            code: `import type { X } from '../other';
export type { X };`,
          },
          { rel: 'other.ts', code: `export type X = string;` },
        ],
        dirs: ['src'],
        expected: 1,
      },
      {
        name: 'block scope shadow — import X used after block — allowed',
        files: [
          {
            rel: 'src/index.ts',
            code: `import { X } from '../other';
{ const X = 1; }
const val: X = {};
export { X };`,
          },
          { rel: 'other.ts', code: `export const X = 1;` },
        ],
        dirs: ['src'],
        expected: 0,
      },
      {
        name: 'shadow: import { X } from "../other"; function foo() { const X = 1; use(X); } export { X } — detects finding',
        files: [
          {
            rel: 'src/index.ts',
            code: `import { X } from '../other';
function foo() { const X = 1; return X; }
export { X };`,
          },
          { rel: 'other.ts', code: `export const X = 1;` },
        ],
        dirs: ['src'],
        expected: 1,
      },
    ];

    it.each(cases)('$name', async c => {
      const findings = await runReexport(c);

      expect(findings.length).toBe(c.expected);
    });
  });

  // ─── cross-module-reexport: 구문 C (import + export default) ─────────────

  describe('checkCrossModuleReexport — syntax C: import + export default', () => {
    const cases: ReexportCase[] = [
      {
        name: 'import X from "../other"; export default X — X not used locally — detects finding',
        files: [
          {
            rel: 'src/index.ts',
            code: `import X from '../other';
export default X;`,
          },
          { rel: 'other.ts', code: `export default class X {}` },
        ],
        dirs: ['src'],
        expected: 1,
      },
      {
        name: 'import X from "../other"; export default X — X used locally — allowed',
        files: [
          {
            rel: 'src/index.ts',
            code: `import X from '../other';
const inst = new X();
export default X;`,
          },
          { rel: 'other.ts', code: `export default class X {}` },
        ],
        dirs: ['src'],
        expected: 0,
      },
      {
        name: 'import X from "../other"; export default new X() — transformation — allowed',
        files: [
          {
            rel: 'src/index.ts',
            code: `import X from '../other';
export default new X();`,
          },
          { rel: 'other.ts', code: `export default class X {}` },
        ],
        dirs: ['src'],
        expected: 0,
      },
      {
        name: 'import X from "./child/mod"; export default X — child path — allowed',
        files: [
          {
            rel: 'src/index.ts',
            code: `import X from './child/mod';
export default X;`,
          },
          { rel: 'src/child/mod.ts', code: `export default class X {}` },
        ],
        dirs: ['src/child'],
        expected: 0,
      },
    ];

    it.each(cases)('$name', async c => {
      const findings = await runReexport(c);

      expect(findings.length).toBe(c.expected);
    });
  });

  // ─── gildash re-export pruning ──────────────────────────────────────────────

  describe('checkCrossModuleReexport — gildash pruning', () => {
    // All rows use the same syntax-A source (real cross-module re-export); only the
    // gildash.searchRelations behavior and the resulting finding count vary:
    //  - confirms → finding kept;
    //  - empty → pattern A pruned (acceptable false negative, gildash trusted);
    //  - throws → null → fallback to AST → finding detected.
    const cases: GildashReexportCase[] = [
      {
        name: 'syntax A — gildash confirms cross-module — still detects finding',
        files: [
          { rel: 'src/index.ts', code: `export { X } from '../other';` },
          { rel: 'other.ts', code: `export const X = 1;` },
        ],
        dirs: ['src'],
        expected: 1,
        gildash: () => ({
          searchRelations: () => [
            { type: 're-exports', srcFilePath: 'src/index.ts', dstFilePath: 'other.ts', srcSymbolName: 'X', dstSymbolName: 'X' },
          ],
        }),
      },
      {
        name: 'syntax A — gildash says no cross-module — skips pattern A',
        files: [
          { rel: 'src/index.ts', code: `export { X } from '../other';` },
          { rel: 'other.ts', code: `export const X = 1;` },
        ],
        dirs: ['src'],
        expected: 0,
        gildash: () => ({
          searchRelations: () => [],
        }),
      },
      {
        name: 'syntax A — gildash throws — falls back to AST detection',
        files: [
          { rel: 'src/index.ts', code: `export { X } from '../other';` },
          { rel: 'other.ts', code: `export const X = 1;` },
        ],
        dirs: ['src'],
        expected: 1,
        gildash: () => ({
          searchRelations: () => {
            throw new Error('gildash error');
          },
        }),
      },
    ];

    it.each(cases)('$name', async c => {
      const findings = await runReexport(c, c.gildash());

      expect(findings.length).toBe(c.expected);
    });
  });
});
