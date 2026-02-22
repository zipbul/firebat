import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { createImportResolver, createWorkspacePackageMap } from './resolver';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'firebat-resolver-test-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const normPath = (p: string): string => p.replaceAll('\\', '/');

describe('features/barrel-policy/resolver — createWorkspacePackageMap', () => {
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
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'root', workspaces: ['packages/*'] }),
    );
    const map = await createWorkspacePackageMap(tmpDir);
    expect(map.has('@my/utils')).toBe(true);
    expect(normPath(map.get('@my/utils') ?? '')).toContain('packages/utils');
  });
});

describe('features/barrel-policy/resolver — createImportResolver', () => {
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
});
