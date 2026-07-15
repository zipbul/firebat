import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ParsedFile } from '../../engine/types';

import { rmrf } from '../../../test/integration/shared/test-kit';
import { parseFileAs as toFile } from '../../../test/integration/shared/test-kit';
import { analyzeBarrel, createEmptyBarrel } from './analyzer';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'firebat-barrel-test-'));
});

afterEach(() => rmrf(tmpDir));

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

/** Register `it.each` asserting each reexport case's finding count. */
const itEachReexportCount = (cases: ReexportCase[]): void => {
  it.each(cases)('$name', async c => {
    const findings = await runReexport(c);

    expect(findings.length).toBe(c.expected);
  });
};

/** Register `it.each` asserting each reexport case's finding count and first file. */
const itEachReexportFile = (cases: ReexportFileCase[]): void => {
  it.each(cases)('$name', async c => {
    const findings = await runReexport(c);

    expect(findings.length).toBe(c.expected);
    expect(findings[0]?.file).toContain(c.fileContains);
  });
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

    itEachReexportFile(fileCases);

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

    itEachReexportCount(cases);
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

    itEachReexportFile(fileCases);

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

    itEachReexportCount(cases);

    // Finding #2 (adversarial review): `import { X, Y } from '../other'; export
    // { X, Y };` must dedupe to exactly one finding per (statement, origin
    // source) — the two specifiers share the same origin, so this is one
    // decision, not two. A statement exporting bindings from two DIFFERENT
    // origins legitimately produces two findings with distinct evidence.
    it('import { X, Y } from "../other"; export { X, Y } — same origin — dedupes to exactly 1 finding', async () => {
      const findings = await runReexport({
        name: 'same-origin dedupe',
        files: [
          {
            rel: 'src/index.ts',
            code: `import { X, Y } from '../other';
export { X, Y };`,
          },
          { rel: 'other.ts', code: `export const X = 1;\nexport const Y = 2;` },
        ],
        dirs: ['src'],
        expected: 1,
      });

      expect(findings.length).toBe(1);
    });

    it('import { X } from "../a"; import { Y } from "../b"; export { X, Y } — different origins — 2 findings with distinct evidence', async () => {
      const findings = await runReexport({
        name: 'different-origins no-dedupe',
        files: [
          {
            rel: 'src/index.ts',
            code: `import { X } from '../a';
import { Y } from '../b';
export { X, Y };`,
          },
          { rel: 'a.ts', code: `export const X = 1;` },
          { rel: 'b.ts', code: `export const Y = 2;` },
        ],
        dirs: ['src'],
        expected: 2,
      });

      expect(findings.length).toBe(2);
      expect(new Set(findings.map(f => f.evidence)).size).toBe(2);
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

    itEachReexportCount(cases);
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

  // ── barrel-surgery (settled definition) — RED-first ──
  // PLAN-barrel-surgery.md D2/D3/D11/D17: most rows below assert POST-surgery
  // behavior (segment-safe ancestor-K, demand-driven missing-index, deep-import
  // scoped to ImportDeclaration edges only) that the current analyzer does not
  // yet implement — RED is expected until Phase 2. A few lock boundaries the
  // current implementation already satisfies correctly (GREEN); each test's
  // comment says which and why.
  describe('barrel-surgery (settled definition)', () => {
    const norm = (p: string): string => p.replaceAll('\\', '/');

    // B1 — segment-safe ancestor boundary: "/…/ab" is NOT an ancestor of
    // "/…/a" even though the string "ab" starts with "a". A naive
    // `startsWith(ancestorDir)` check (without a trailing separator) would
    // wrongly treat /ab as a descendant of /a and suppress this deep-import.
    // GREEN today: the current analyzer has no ancestor-K exemption at all
    // (every cross-directory import to a non-index file fires deep-import
    // unconditionally), so this boundary already holds by construction; it
    // must keep holding once ancestor-K is implemented.
    it('B1: sibling dir sharing a name prefix ("ab" vs "a") still fires deep-import', async () => {
      await fs.mkdir(path.join(tmpDir, 'ab'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'a'), { recursive: true });

      const files = [
        toFile(path.join(tmpDir, 'ab/x.ts'), `import { internal } from '../a/internal';`),
        toFile(path.join(tmpDir, 'a/index.ts'), `export { internal } from './internal';`),
        toFile(path.join(tmpDir, 'a/internal.ts'), `export const internal = 1;`),
      ];
      const result = await analyzeBarrel(files, { rootAbs: tmpDir });

      expect(result.some(f => f.kind === 'deep-import')).toBe(true);
    });

    // B2 — multi-level demand attribution (D17): consuming `a/b/c.ts` via a
    // relative import creates demand on the TARGET's immediate directory
    // (`a/b`) only, never on an ancestor directory (`a`) that owns no surface
    // itself. RED today: missing-index is census-based (every directory
    // lacking index.ts is flagged regardless of demand), so both `consumer`
    // and `a/b` are flagged (2 findings), not exactly 1 scoped to `a/b`.
    it('B2: demand attaches to the immediate target dir only, not ancestor dirs', async () => {
      await fs.mkdir(path.join(tmpDir, 'consumer'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'a/b'), { recursive: true });

      const files = [
        toFile(path.join(tmpDir, 'consumer/x.ts'), `import { c } from '../a/b/c';`),
        toFile(path.join(tmpDir, 'a/b/c.ts'), `export const c = 1;`),
      ];
      const result = await analyzeBarrel(files, { rootAbs: tmpDir });
      const missingIndex = result.filter(f => f.kind === 'missing-index');

      expect(missingIndex.length).toBe(1);
      expect(missingIndex.some(f => norm(f.file) === norm(path.join(tmpDir, 'a/b')))).toBe(true);
    });

    // B3 — re-export edges create no demand (D17) and are exempt from
    // deep-import (D11: deep-import applies to ImportDeclaration edges only;
    // re-export edges are governed solely by the cross-module-reexport origin
    // rule). RED today: the current analyzer treats ExportNamedDeclaration /
    // ExportAllDeclaration as deep-import candidates too (collectImportLikes),
    // and missing-index is census-based — so today's total is 4 (2×
    // missing-index census + 1× deep-import co-finding + 1×
    // cross-module-reexport), not the exact 1 (cross-module-reexport only)
    // the settled definition demands.
    it('B3: a re-export edge creates no demand and no deep-import co-finding', async () => {
      await fs.mkdir(path.join(tmpDir, 'm'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'lib'), { recursive: true });

      const files = [
        toFile(path.join(tmpDir, 'm/agg.ts'), `export { c } from '../lib/c';`),
        toFile(path.join(tmpDir, 'lib/c.ts'), `export const c = 1;`),
      ];
      const result = await analyzeBarrel(files, { rootAbs: tmpDir });

      expect(result.filter(f => f.kind === 'missing-index').length).toBe(0);
      expect(result.filter(f => f.kind === 'cross-module-reexport').length).toBe(1);
      expect(result.length).toBe(1);
    });

    // B4 — an unresolvable re-export source is held (zero findings of any
    // kind): it cannot create demand (D17, re-export edges never create
    // demand), and resolution failure is a documented hold (D8) for every
    // other check. RED today: missing-index is census-based, so the file's
    // own directory (lacking index.ts) is flagged regardless of the
    // unresolved re-export.
    it('B4: an unresolvable re-export source produces zero findings', async () => {
      await fs.mkdir(path.join(tmpDir, 'only'), { recursive: true });

      const files = [toFile(path.join(tmpDir, 'only/file.ts'), `export { x } from './does-not-exist';`)];
      const result = await analyzeBarrel(files, { rootAbs: tmpDir });

      expect(result).toEqual([]);
    });

    // B5 — workspace-specifier deep-import: a real fs.mkdtemp project with a
    // package.json `workspaces` field and a nested package.json `name` field
    // ("@w/lib") so createWorkspacePackageMap can see the map from real files
    // on disk (it globs the workspace pattern and reads package.json — unlike
    // the rest of the resolver, which is pure fileSet/string logic and needs
    // no real files). Deep-import evidence already suggests the workspace
    // specifier today (unrelated to the D1–D19 kind surgery) — GREEN. The K
    // side (importing the bare package specifier, which resolves to its
    // index) is RED today only because census missing-index flags the
    // importer's own directory.
    describe('B5: workspace-specifier deep-import (real fs.mkdtemp)', () => {
      const writeWorkspaceManifest = async (): Promise<void> => {
        await fs.mkdir(path.join(tmpDir, 'packages/lib'), { recursive: true });
        await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
        await fs.writeFile(path.join(tmpDir, 'packages/lib/package.json'), JSON.stringify({ name: '@w/lib' }));
      };

      it('deep-importing a workspace package subpath suggests the package specifier', async () => {
        await writeWorkspaceManifest();
        await fs.mkdir(path.join(tmpDir, 'app'), { recursive: true });

        const files = [
          toFile(path.join(tmpDir, 'app/x.ts'), `import { internal } from '@w/lib/internal';`),
          toFile(path.join(tmpDir, 'packages/lib/internal.ts'), `export const internal = 1;`),
          toFile(path.join(tmpDir, 'packages/lib/index.ts'), `export { internal } from './internal';`),
        ];
        const result = await analyzeBarrel(files, { rootAbs: tmpDir });
        const deepImports = result.filter(f => f.kind === 'deep-import');

        expect(deepImports.length).toBe(1);
        expect(deepImports[0]?.evidence).toBe('suggest: @w/lib');
      });

      it('importing the bare workspace package specifier (resolves to its index) is silent', async () => {
        await writeWorkspaceManifest();
        await fs.mkdir(path.join(tmpDir, 'app'), { recursive: true });

        const files = [
          toFile(path.join(tmpDir, 'app/x.ts'), `import { internal } from '@w/lib';`),
          // CONFORMING index (named re-export) — a local declaration here would be its own
          // invalid-index-statement and mask the K-contract this test locks (surface consumption
          // via the bare workspace specifier is silent).
          toFile(path.join(tmpDir, 'packages/lib/internal.ts'), `export const internal = 1;`),
          toFile(path.join(tmpDir, 'packages/lib/index.ts'), `export { internal } from './internal';`),
        ];
        const result = await analyzeBarrel(files, { rootAbs: tmpDir });

        expect(result).toEqual([]);
      });

      // Same-package deep-import: importer and target dir are both inside the
      // SAME workspace package root (packages/lib). `toAllowedBarrelSpecifier`
      // used to prefer the workspace-package form whenever the target dir was
      // inside ANY workspace package root, regardless of where the importer
      // lives — producing `@w/lib/src/b` here, which does not round-trip back
      // to `packages/lib/src/b` under a typical tsconfig `@w/lib/*` ->
      // `./packages/lib/src/*` path alias (it would resolve to
      // `packages/lib/src/src/b`, doubling `src`). Within one package the
      // correct suggestion is the plain relative directory specifier.
      it('same-package deep-import suggests a relative specifier, not the workspace-package form', async () => {
        await writeWorkspaceManifest();
        await fs.mkdir(path.join(tmpDir, 'packages/lib/src/a'), { recursive: true });
        await fs.mkdir(path.join(tmpDir, 'packages/lib/src/b'), { recursive: true });

        const files = [
          toFile(path.join(tmpDir, 'packages/lib/src/a/x.ts'), `import { internal } from '../b/internal';`),
          toFile(path.join(tmpDir, 'packages/lib/src/b/internal.ts'), `export const internal = 1;`),
          toFile(path.join(tmpDir, 'packages/lib/src/b/index.ts'), `export { internal } from './internal';`),
        ];
        const result = await analyzeBarrel(files, { rootAbs: tmpDir });
        const deepImports = result.filter(f => f.kind === 'deep-import');

        expect(deepImports.length).toBe(1);
        expect(deepImports[0]?.evidence).toBe('suggest: ../b');
      });
    });

    // B6 — determinism: running analyzeBarrel twice over the identical parsed
    // program must yield byte-identical JSON. GREEN both pre- and
    // post-surgery: no Date/Math.random, and Set/Map iteration is
    // insertion-order over a stable input array.
    it('B6: running analyzeBarrel twice over the same program is byte-identical', async () => {
      await fs.mkdir(path.join(tmpDir, 'consumer'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'lib'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'bar'), { recursive: true });

      const files = [
        toFile(path.join(tmpDir, 'consumer/x.ts'), `import { util } from '../lib/util';\nexport const y = util;`),
        toFile(path.join(tmpDir, 'lib/util.ts'), `export const util = 1;`),
        toFile(path.join(tmpDir, 'bar/index.ts'), `export * from './internal';`),
        toFile(path.join(tmpDir, 'bar/internal.ts'), `export const z = 1;`),
      ];

      const first = await analyzeBarrel(files, { rootAbs: tmpDir });
      const second = await analyzeBarrel(files, { rootAbs: tmpDir });

      expect(first.length).toBeGreaterThan(0);
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    });

    // B7 — companion to the approved __fixtures__/dynamic-and-ignored-keep.dir/
    // m/b.spec.ts repair (bun's own test runner collects any real *.spec.ts
    // file under the repo, including fixtures — that file's original content
    // had to be swapped for inert type-only code so `bun test` wouldn't try to
    // execute and fail it). This test locks the semantics that content used to
    // exercise — a *.spec.* file's `export * from` emits no export-star and its
    // ImportDeclaration edges create no demand (default-ignore glob) — using
    // ONLY in-memory ParsedFile sources (parseFileAs never writes to disk), so
    // no collectible file is ever created.
    it('B7: a **/*.spec.* file emits no export-star and creates no demand (ignored)', async () => {
      await fs.mkdir(path.join(tmpDir, 'lib'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'm'), { recursive: true });

      const files = [
        toFile(path.join(tmpDir, 'lib/util.ts'), `export const u = 1;`),
        toFile(path.join(tmpDir, 'm/b.spec.ts'), `import { u } from '../lib/util';\nexport * from '../lib';`),
      ];
      const result = await analyzeBarrel(files, { rootAbs: tmpDir });

      expect(result).toEqual([]);
    });

    // F4 (adversarial review): `fileSet.has(targetIndexAbs)` conflates "not in
    // the scan set" with "absent on disk". With explicit file targets (a
    // changed-files workflow), an existing lib/index.ts REAL file that simply
    // isn't part of this run's `program` must not be reported as missing —
    // that would be a factually false missing-index W. Real lib/index.ts and
    // lib/util.ts are written to disk, but `program` below (and therefore
    // fileSet) contains only app/x.ts and lib/util.ts — NOT lib/index.ts. Fix:
    // probe disk (fs.existsSync) on a fileSet miss; exists on disk -> hold
    // BOTH missing-index and deep-import for that dir/edge (FN direction,
    // since the surface's actual content can't be verified from this scan).
    it('F4: index.ts existing on disk but outside the scan set holds both missing-index and deep-import', async () => {
      await fs.mkdir(path.join(tmpDir, 'lib'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'app'), { recursive: true });

      await fs.writeFile(path.join(tmpDir, 'lib/index.ts'), `export { util } from './util';`);
      await fs.writeFile(path.join(tmpDir, 'lib/util.ts'), `export const util = 1;`);

      const files = [
        toFile(path.join(tmpDir, 'app/x.ts'), `import { util } from '../lib/util';`),
        toFile(path.join(tmpDir, 'lib/util.ts'), `export const util = 1;`),
      ];
      const result = await analyzeBarrel(files, { rootAbs: tmpDir });

      expect(result).toEqual([]);
    });

    // F7 (adversarial review): `toAllowedBarrelSpecifier` used to pick the
    // FIRST workspace root containing the target dir — with overlapping/nested
    // package roots (packages/a and packages/a/nested both declaring a
    // package.json name), the pick depended on Map iteration order (readdir /
    // declaration order), producing unstable `suggest:` evidence. Fix: prefer
    // the LONGEST (most specific) matching pkgRoot. workspaces below declares
    // the OUTER root first ("packages/a") and the NESTED root second
    // ("packages/a/nested") — the pre-fix "first containing root wins" pick
    // would always resolve the outer, less-specific package regardless of the
    // true nesting; the fix must resolve the nested one every time.
    it('F7: deep-import into an overlapping/nested workspace package suggests the LONGEST matching package root', async () => {
      await fs.mkdir(path.join(tmpDir, 'packages/a/nested'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'app'), { recursive: true });

      await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ workspaces: ['packages/a', 'packages/a/nested'] }));
      await fs.writeFile(path.join(tmpDir, 'packages/a/package.json'), JSON.stringify({ name: '@w/a' }));
      await fs.writeFile(path.join(tmpDir, 'packages/a/nested/package.json'), JSON.stringify({ name: '@w/a-nested' }));

      const files = [
        toFile(path.join(tmpDir, 'app/x.ts'), `import { internal } from '../packages/a/nested/internal';`),
        toFile(path.join(tmpDir, 'packages/a/nested/internal.ts'), `export const internal = 1;`),
        toFile(path.join(tmpDir, 'packages/a/nested/index.ts'), `export { internal } from './internal';`),
      ];
      const result = await analyzeBarrel(files, { rootAbs: tmpDir });
      const deepImports = result.filter(f => f.kind === 'deep-import');

      expect(deepImports.length).toBe(1);
      expect(deepImports[0]?.evidence).toBe('suggest: @w/a-nested');
    });

    // F7 (order-independence): same fixture, but `workspaces` declares the
    // NESTED root FIRST and the outer root SECOND — the opposite declaration
    // order from the test above. The longest-match pick must be independent
    // of declaration/insertion order in either direction.
    it('F7: the longest-match pick is independent of workspaces declaration order', async () => {
      await fs.mkdir(path.join(tmpDir, 'packages/a/nested'), { recursive: true });
      await fs.mkdir(path.join(tmpDir, 'app'), { recursive: true });

      await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ workspaces: ['packages/a/nested', 'packages/a'] }));
      await fs.writeFile(path.join(tmpDir, 'packages/a/package.json'), JSON.stringify({ name: '@w/a' }));
      await fs.writeFile(path.join(tmpDir, 'packages/a/nested/package.json'), JSON.stringify({ name: '@w/a-nested' }));

      const files = [
        toFile(path.join(tmpDir, 'app/x.ts'), `import { internal } from '../packages/a/nested/internal';`),
        toFile(path.join(tmpDir, 'packages/a/nested/internal.ts'), `export const internal = 1;`),
        toFile(path.join(tmpDir, 'packages/a/nested/index.ts'), `export { internal } from './internal';`),
      ];
      const result = await analyzeBarrel(files, { rootAbs: tmpDir });
      const deepImports = result.filter(f => f.kind === 'deep-import');

      expect(deepImports.length).toBe(1);
      expect(deepImports[0]?.evidence).toBe('suggest: @w/a-nested');
    });
  });
});
