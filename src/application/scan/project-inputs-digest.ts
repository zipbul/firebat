import { readdir } from 'node:fs/promises';
import * as path from 'node:path';

import type { Gildash } from '@zipbul/gildash';

import { isErr } from '@zipbul/result';
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
  readonly rootAbs: string;
  readonly gildash: Gildash;
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
        return;
      }

      try {
        const fileRec = input.gildash.getFileInfo(filePath);

        if (!isErr(fileRec) && fileRec !== null) {
          partsByIndex[item.index] = `project:${filePath}:${fileRec.contentHash}`;
          return;
        }

        const file = Bun.file(item.filePathAbs);
        const content = await file.text();
        const contentHash = hashString(content);

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
