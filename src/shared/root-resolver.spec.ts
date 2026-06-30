import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { assertTargetsWithinRoot, isWithinRoot, resolveFirebatRootFromCwd } from './root-resolver';

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await Bun.write(filePath, JSON.stringify(value, null, 2));
};

describe('root-resolver', () => {
  it('should resolve declared-dependency root when started inside node_modules/firebat', async () => {
    // Arrange
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'firebat-root-resolver-'));
    const appPkgJsonPath = path.join(projectRoot, 'package.json');
    const installedFirebatDir = path.join(projectRoot, 'node_modules', 'firebat');
    const installedFirebatPkgJsonPath = path.join(installedFirebatDir, 'package.json');

    await writeJson(appPkgJsonPath, { name: 'my-app', dependencies: { firebat: '1.0.0' } });
    await writeJson(installedFirebatPkgJsonPath, { name: 'firebat' });

    // Act
    const resolved = await resolveFirebatRootFromCwd(installedFirebatDir);

    // Assert
    expect(resolved).toEqual({ rootAbs: projectRoot, reason: 'declared-dependency' });

    await rm(projectRoot, { recursive: true, force: true });
  });

  it('should resolve self-repo root when started in the firebat repo itself', async () => {
    // Arrange
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'firebat-self-repo-'));
    const pkgJsonPath = path.join(repoRoot, 'package.json');

    await writeJson(pkgJsonPath, { name: 'firebat' });

    // Act
    const resolved = await resolveFirebatRootFromCwd(repoRoot);

    // Assert
    expect(resolved).toEqual({ rootAbs: repoRoot, reason: 'self-repo' });

    await rm(repoRoot, { recursive: true, force: true });
  });
});

describe('isWithinRoot', () => {
  it('returns true for the root itself', () => {
    expect(isWithinRoot('/proj', '/proj')).toBe(true);
  });

  it('returns true for a nested child', () => {
    expect(isWithinRoot('/proj/src/a.ts', '/proj')).toBe(true);
  });

  it('returns false for a sibling outside the root', () => {
    expect(isWithinRoot('/other/a.ts', '/proj')).toBe(false);
  });

  it('returns false for a prefix-collision sibling (/proj vs /proj-other)', () => {
    expect(isWithinRoot('/proj-other/a.ts', '/proj')).toBe(false);
  });

  it('returns false for a parent directory', () => {
    expect(isWithinRoot('/proj', '/proj/src')).toBe(false);
  });
});

describe('assertTargetsWithinRoot', () => {
  it('does not throw when all targets are within the root', () => {
    expect(() => assertTargetsWithinRoot(['/proj/a.ts', '/proj/src/b.ts', '/proj'], '/proj')).not.toThrow();
  });

  it('does not throw for an empty target list', () => {
    expect(() => assertTargetsWithinRoot([], '/proj')).not.toThrow();
  });

  it('throws naming the project root and the offending target when one is outside', () => {
    expect(() => assertTargetsWithinRoot(['/proj/a.ts', '/other/b.ts'], '/proj')).toThrow(/outside the project root \/proj/);
  });

  it('reports a truncated count when many targets are outside', () => {
    const outside = ['/x/1.ts', '/x/2.ts', '/x/3.ts', '/x/4.ts', '/x/5.ts'];

    expect(() => assertTargetsWithinRoot(outside, '/proj')).toThrow(/and 2 more/);
  });
});
