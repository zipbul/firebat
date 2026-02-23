import { readdir } from 'node:fs/promises';
import * as path from 'node:path';

import type { FileIndexStore } from '../../store/file-index';

import { hashString } from '../../engine/hasher';
import { runWithConcurrency } from '../../engine/promise-pool';

const normalizePath = (filePath: string): string => filePath.replaceAll('\\', '/');

const listRootTsconfigs = async (rootAbs: string): Promise<string[]> => {
  if (rootAbs.trim().length === 0) {
    return [];
  }

  try {
    const entries = await readdir(rootAbs, { withFileTypes: true });

    return entries
      .filter(e => e.isFile() && e.name.startsWith('tsconfig') && e.name.endsWith('.json'))
      .map(e => path.resolve(rootAbs, e.name));
  } catch {
    return [];
  }
};

const listProjectInputFiles = async (rootAbs: string): Promise<string[]> => {
  const candidates: string[] = [
    path.resolve(rootAbs, 'package.json'),
    path.resolve(rootAbs, 'bun.lockb'),
    path.resolve(rootAbs, 'package-lock.json'),
    path.resolve(rootAbs, 'pnpm-lock.yaml'),
    path.resolve(rootAbs, 'yarn.lock'),
  ];
  const tsconfigs = await listRootTsconfigs(rootAbs);

  return [...new Set([...candidates, ...tsconfigs])];
};

interface ProjectInputsDigestInput {
  readonly projectKey: string;
  readonly rootAbs: string;
  readonly fileIndexRepository: FileIndexStore;
}

const computeProjectInputsDigest = async (input: ProjectInputsDigestInput): Promise<string> => {
  const files = await listProjectInputFiles(input.rootAbs);

  if (files.length === 0) {
    return hashString('');
  }

  const partsByIndex: string[] = new Array<string>(files.length);
  const concurrency = Math.max(1, Math.min(16, files.length));

  await runWithConcurrency(
    files.map((filePathAbs, index) => ({ filePathAbs, index })),
    concurrency,
    async item => {
      const filePath = normalizePath(item.filePathAbs);
      const isEmptyPath = filePath.trim().length === 0;

      if (isEmptyPath) {
        partsByIndex[item.index] = `project:missing:${filePath}`;
      }

      if (isEmptyPath) {
        return;
      }

      try {
        const existing = input.fileIndexRepository.getFile({ projectKey: input.projectKey, filePath });

        if (existing) {
          partsByIndex[item.index] = `project:${filePath}:${existing.contentHash}`;

          return;
        }

        const file = Bun.file(item.filePathAbs);
        const [stats, content] = await Promise.all([file.stat(), file.text()]);
        const contentHash = hashString(content);

        input.fileIndexRepository.upsertFile({
          projectKey: input.projectKey,
          filePath,
          mtimeMs: stats.mtimeMs,
          size: stats.size,
          contentHash,
        });

        partsByIndex[item.index] = `project:${filePath}:${contentHash}`;
      } catch {
        // Non-existent project files are part of the digest too (stable miss).
        partsByIndex[item.index] = `project:missing:${filePath}`;
      }
    },
  );

  const parts: string[] = [];

  for (let i = 0; i < partsByIndex.length; i += 1) {
    const part = partsByIndex[i];
    const filePath = normalizePath(files[i] ?? '');

    parts.push(part ?? `project:missing:${filePath}`);
  }

  return hashString(parts.sort().join('|'));
};

export { computeProjectInputsDigest };
