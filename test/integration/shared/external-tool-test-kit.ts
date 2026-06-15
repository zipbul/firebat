import { expect } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { resolveToolRcPath } from '../../../src/test-api';

export interface TempProject {
  readonly rootAbs: string;
  dispose: () => Promise<void>;
}

export const createTempProject = async (prefix: string): Promise<TempProject> => {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  const rootAbs = await fs.realpath(raw);

  const dispose = async (): Promise<void> => {
    await fs.rm(rootAbs, { recursive: true, force: true });
  };

  return { rootAbs, dispose };
};

export const writeText = async (filePath: string, content: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
};

export const readText = async (filePath: string): Promise<string> => {
  return fs.readFile(filePath, 'utf8');
};

/**
 * Assert that {@link resolveToolRcPath} does NOT search parent directories: an
 * rc file placed in the project root is invisible to a nested child dir.
 *
 * Shared by the format/lint `config-missing` specs, which differ only by the rc
 * filename they probe.
 */
export const expectRcNotResolvedFromParent = async (prefix: string, rcName: string): Promise<void> => {
  const parent = await createTempProject(prefix);

  try {
    const childAbs = path.join(parent.rootAbs, 'child');

    await writeText(path.join(parent.rootAbs, rcName), '{ /* parent */ }');
    await writeText(path.join(childAbs, 'placeholder.txt'), 'ok');

    const resolved = await resolveToolRcPath(childAbs, rcName);

    expect(resolved).toBeUndefined();
  } finally {
    await parent.dispose();
  }
};

/**
 * Assert that {@link resolveToolRcPath} resolves an rc file living directly in
 * `rootAbs`. Shared by the format/lint `config-found` specs, which differ only
 * by the rc filename they probe.
 */
export const expectRcResolvedFromRoot = async (prefix: string, rcName: string): Promise<void> => {
  const project = await createTempProject(prefix);

  try {
    const configAbs = path.join(project.rootAbs, rcName);

    await writeText(configAbs, '{ /* test */ }');

    const resolved = await resolveToolRcPath(project.rootAbs, rcName);

    expect(resolved).toBe(configAbs);
  } finally {
    await project.dispose();
  }
};

export const installFakeBin = async (rootAbs: string, binName: string, script: string): Promise<string> => {
  const binDir = path.join(rootAbs, 'node_modules', '.bin');
  const binPath = path.join(binDir, binName);

  await fs.mkdir(binDir, { recursive: true });
  await fs.writeFile(binPath, script, 'utf8');
  await fs.chmod(binPath, 0o755);

  return binPath;
};
