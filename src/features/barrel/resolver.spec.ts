import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { rmrf } from '../../../test/integration/shared/test-kit';
import { createImportResolver, createWorkspacePackageMap } from './resolver';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'firebat-resolver-test-'));
});

afterEach(() => rmrf(tmpDir));

const normPath = (p: string): string => p.replaceAll('\\', '/');

describe('features/barrel/resolver — createWorkspacePackageMap', () => {
  it('returns empty Map when no package.json exists', async () => {
    const map = await createWorkspacePackageMap(tmpDir);

    expect(map.size).toBe(0);
  });

  it('returns empty Map when package.json has no workspaces field', async () => {
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root' }));

    const map = await createWorkspacePackageMap(tmpDir);

    expect(map.size).toBe(0);
  });

  it('returns packages from workspaces array glob', async () => {
    const pkgDir = path.join(tmpDir, 'packages', 'utils');

    await fs.mkdir(pkgDir, { recursive: true });
    await fs.writeFile(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@my/utils' }));
    await fs.writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'root', workspaces: ['packages/*'] }));

    const map = await createWorkspacePackageMap(tmpDir);

    expect(map.has('@my/utils')).toBe(true);
    expect(normPath(map.get('@my/utils') ?? '')).toContain('packages/utils');
  });
});

describe('features/barrel/resolver — createImportResolver', () => {
  it('resolve returns null for external packages not in workspace', async () => {
    const fileSet = new Set<string>([normPath(path.join(tmpDir, 'src/a.ts'))]);
    const resolver = createImportResolver({ rootAbs: tmpDir, fileSet, workspacePackages: new Map() });
    const result = await resolver.resolve(normPath(path.join(tmpDir, 'src/a.ts')), 'lodash');

    expect(result).toBeNull();
  });

  it('resolve resolves relative imports that exist in fileSet', async () => {
    const a = normPath(path.join(tmpDir, 'src/a.ts'));
    const b = normPath(path.join(tmpDir, 'src/b.ts'));
    const fileSet = new Set<string>([a, b]);
    const resolver = createImportResolver({ rootAbs: tmpDir, fileSet, workspacePackages: new Map() });
    const result = await resolver.resolve(a, './b');

    expect(result).toBe(b);
  });

  it('resolve returns null for relative import not in fileSet', async () => {
    const a = normPath(path.join(tmpDir, 'src/a.ts'));
    const fileSet = new Set<string>([a]);
    const resolver = createImportResolver({ rootAbs: tmpDir, fileSet, workspacePackages: new Map() });
    const result = await resolver.resolve(a, './missing');

    expect(result).toBeNull();
  });

  it('resolve supports workspace package resolution', async () => {
    const pkgRoot = normPath(path.join(tmpDir, 'packages/utils'));
    const pkgIndex = normPath(path.join(pkgRoot, 'index.ts'));
    const fileSet = new Set<string>([pkgIndex]);
    const workspacePackages = new Map([['@my/utils', pkgRoot]]);
    const importer = normPath(path.join(tmpDir, 'src/a.ts'));
    const resolver = createImportResolver({ rootAbs: tmpDir, fileSet, workspacePackages });
    const result = await resolver.resolve(importer, '@my/utils');

    expect(result).toBe(pkgIndex);
  });

  it('resolve supports tsconfig paths alias', async () => {
    const srcDir = path.join(tmpDir, 'src');

    await fs.mkdir(srcDir, { recursive: true });

    const utilsFile = normPath(path.join(srcDir, 'utils.ts'));
    const importer = normPath(path.join(srcDir, 'main.ts'));

    await fs.writeFile(
      path.join(tmpDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@utils': ['src/utils'] } } }),
    );

    const fileSet = new Set<string>([utilsFile, importer]);
    const workspacePackages = new Map<string, string>();
    const resolver = createImportResolver({ rootAbs: tmpDir, fileSet, workspacePackages });
    const result = await resolver.resolve(importer, '@utils');

    expect(result).toBe(utilsFile);
  });

  // ── tsconfig paths precedence (TS spec: exact pattern beats wildcard;
  // among wildcards, longest matched literal prefix wins) — Object.entries
  // insertion order must NOT decide the winner.
  it('resolve prefers an exact-match path pattern over a matching wildcard pattern', async () => {
    const srcDir = path.join(tmpDir, 'src');

    await fs.mkdir(srcDir, { recursive: true });

    // Exact pattern's target: an index file (the "correct" resolution).
    const libIndex = normPath(path.join(srcDir, 'lib/index.ts'));
    // Wildcard pattern's target: a non-index file (the "wrong" resolution a
    // naive insertion-order-wins implementation would pick, since the
    // wildcard key is declared first).
    const fallbackInternal = normPath(path.join(srcDir, 'fallback/lib/internal.ts'));
    const importer = normPath(path.join(srcDir, 'main.ts'));

    await fs.writeFile(
      path.join(tmpDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['src/fallback/*'],
            '@/lib/internal': ['src/lib/index.ts'],
          },
        },
      }),
    );

    const fileSet = new Set<string>([libIndex, fallbackInternal, importer]);
    const workspacePackages = new Map<string, string>();
    const resolver = createImportResolver({ rootAbs: tmpDir, fileSet, workspacePackages });
    const result = await resolver.resolve(importer, '@/lib/internal');

    expect(result).toBe(libIndex);
  });

  it('resolve prefers the wildcard pattern with the longest matched literal prefix', async () => {
    const srcDir = path.join(tmpDir, 'src');

    await fs.mkdir(srcDir, { recursive: true });

    // Longer-prefix pattern's target (the "correct" resolution).
    const specificTarget = normPath(path.join(srcDir, 'a-impl/x.ts'));
    // Shorter-prefix pattern's target — declared FIRST in the source object,
    // so a naive insertion-order-wins implementation would pick this instead.
    const genericTarget = normPath(path.join(srcDir, 'generic/a/x.ts'));
    const importer = normPath(path.join(srcDir, 'main.ts'));

    await fs.writeFile(
      path.join(tmpDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['src/generic/*'],
            '@/a/*': ['src/a-impl/*'],
          },
        },
      }),
    );

    const fileSet = new Set<string>([specificTarget, genericTarget, importer]);
    const workspacePackages = new Map<string, string>();
    const resolver = createImportResolver({ rootAbs: tmpDir, fileSet, workspacePackages });
    const result = await resolver.resolve(importer, '@/a/x');

    expect(result).toBe(specificTarget);
  });

  // ── F1 (adversarial review): tsc's `matchPatternOrExact` selects EXACTLY ONE
  // pattern (exact > longest literal prefix > declaration order) and tries ONLY
  // that pattern's target array. If none of its substitutions resolve, paths
  // resolution FAILS — it never falls through to a lower-precedence pattern.
  it('does NOT fall through to a lower-precedence pattern when the best pattern fails to resolve', async () => {
    const srcDir = path.join(tmpDir, 'src');

    await fs.mkdir(srcDir, { recursive: true });
    await fs.mkdir(path.join(srcDir, 'shims'), { recursive: true });

    // Only the wildcard pattern's target exists on disk; the exact pattern's
    // target ("./generated/api.ts") does not.
    const shimApi = normPath(path.join(srcDir, 'shims/api.ts'));
    const importer = normPath(path.join(srcDir, 'main.ts'));

    await fs.writeFile(
      path.join(tmpDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@gen/api': ['./generated/api.ts'],
            '@gen/*': ['./src/shims/*'],
          },
        },
      }),
    );

    const fileSet = new Set<string>([shimApi, importer]);
    const workspacePackages = new Map<string, string>();
    const resolver = createImportResolver({ rootAbs: tmpDir, fileSet, workspacePackages });
    const result = await resolver.resolve(importer, '@gen/api');

    expect(result).toBeNull();
  });

  // ── F1: among wildcard patterns with an EQUAL longest matched literal
  // prefix, tsc breaks the tie by declaration order — never lexicographic
  // key-string order.
  it('breaks an equal-literal-prefix-length wildcard tie by declaration order, not lexicographic key order', async () => {
    const srcDir = path.join(tmpDir, 'src');

    await fs.mkdir(path.join(srcDir, 'first'), { recursive: true });
    await fs.mkdir(path.join(srcDir, 'second'), { recursive: true });

    // Specifier '@x/zzxy' matches both patterns below with an equal literal
    // prefix length ('@x/', length 3) — a genuine tie. Declared FIRST:
    // '@x/*y' (lexicographically the GREATER key). Declared SECOND: '@x/*xy'
    // (lexicographically the LESSER key). A lexicographic tie-break would
    // wrongly pick the second-declared pattern; declaration order must pick
    // the first-declared one.
    const firstTarget = normPath(path.join(srcDir, 'first/zzx.ts'));
    const secondTarget = normPath(path.join(srcDir, 'second/zz.ts'));
    const importer = normPath(path.join(srcDir, 'main.ts'));

    await fs.writeFile(
      path.join(tmpDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@x/*y': ['src/first/*'],
            '@x/*xy': ['src/second/*'],
          },
        },
      }),
    );

    const fileSet = new Set<string>([firstTarget, secondTarget, importer]);
    const workspacePackages = new Map<string, string>();
    const resolver = createImportResolver({ rootAbs: tmpDir, fileSet, workspacePackages });
    const result = await resolver.resolve(importer, '@x/zzxy');

    expect(result).toBe(firstTarget);
  });

  // ── F2 (adversarial review): tsc's star-match requires
  // `candidate.length >= prefix.length + suffix.length` — without this guard,
  // an overlapping prefix/suffix produces a false match with an empty star.
  it('does not match a wildcard pattern when prefix and suffix overlap (star would be empty)', async () => {
    const srcDir = path.join(tmpDir, 'src');

    await fs.mkdir(path.join(srcDir, 'target'), { recursive: true });

    const target = normPath(path.join(srcDir, 'target/hit.ts'));
    const importer = normPath(path.join(srcDir, 'main.ts'));

    await fs.writeFile(
      path.join(tmpDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: {
            'lib/*/util': ['src/target/hit'],
          },
        },
      }),
    );

    const fileSet = new Set<string>([target, importer]);
    const workspacePackages = new Map<string, string>();
    const resolver = createImportResolver({ rootAbs: tmpDir, fileSet, workspacePackages });
    const result = await resolver.resolve(importer, 'lib/util');

    expect(result).toBeNull();
  });

  // ── F6 (adversarial review): tsc consults tsconfig `paths` BEFORE workspace
  // package resolution. A specifier matching both must resolve via `paths`.
  it('prefers a tsconfig paths alias over a matching workspace package specifier', async () => {
    const srcDir = path.join(tmpDir, 'src');
    const localLibDir = path.join(srcDir, 'local-lib');

    await fs.mkdir(localLibDir, { recursive: true });

    const pkgRoot = normPath(path.join(tmpDir, 'packages/lib'));
    const pkgIndex = normPath(path.join(pkgRoot, 'index.ts'));
    const aliasTarget = normPath(path.join(localLibDir, 'index.ts'));
    const importer = normPath(path.join(srcDir, 'main.ts'));

    await fs.mkdir(pkgRoot, { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@acme/lib/*': ['src/local-lib/*'] },
        },
      }),
    );

    const fileSet = new Set<string>([pkgIndex, aliasTarget, importer]);
    const workspacePackages = new Map([['@acme/lib', pkgRoot]]);
    const resolver = createImportResolver({ rootAbs: tmpDir, fileSet, workspacePackages });
    const result = await resolver.resolve(importer, '@acme/lib/index');

    expect(result).toBe(aliasTarget);
  });
});
