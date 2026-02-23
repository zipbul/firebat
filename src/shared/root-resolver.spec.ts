import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { resolveFirebatRootFromCwd } from './root-resolver';

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
