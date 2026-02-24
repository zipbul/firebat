import type { Gildash } from '@zipbul/gildash';

import { isErr } from '@zipbul/result';
import { hashString } from '../../engine/hasher';
import { runWithConcurrency } from '../../engine/promise-pool';

const normalizePath = (filePath: string): string => filePath.replaceAll('\\', '/');

interface ComputeInputsDigestInput {
  readonly targets: ReadonlyArray<string>;
  readonly gildash: Gildash;
  readonly extraParts?: ReadonlyArray<string>;
}

const computeInputsDigest = async (input: ComputeInputsDigestInput): Promise<string> => {
  const normalizedTargets = [...input.targets].map(normalizePath).sort();
  const parts: string[] = [...(input.extraParts ?? [])];

  if (normalizedTargets.length === 0) {
    return hashString(parts.join('|'));
  }

  const partsByIndex: string[] = new Array<string>(normalizedTargets.length);
  const concurrency = Math.max(1, Math.min(16, normalizedTargets.length));

  await runWithConcurrency(
    normalizedTargets.map((filePath, index) => ({ filePath, index })),
    concurrency,
    async item => {
      const { filePath, index } = item;
      const isEmptyPath = filePath.trim().length === 0;

      if (isEmptyPath) {
        partsByIndex[index] = `missing:${filePath}`;
        return;
      }

      try {
        const fileRec = input.gildash.getFileInfo(filePath);

        if (!isErr(fileRec) && fileRec !== null) {
          partsByIndex[index] = `file:${filePath}:${fileRec.contentHash}`;
          return;
        }

        const file = Bun.file(filePath);
        const content = await file.text();
        const contentHash = hashString(content);

        partsByIndex[index] = `file:${filePath}:${contentHash}`;
      } catch {
        partsByIndex[index] = `missing:${filePath}`;
      }
    },
  );

  for (let i = 0; i < partsByIndex.length; i += 1) {
    const part = partsByIndex[i];
    parts.push(part ?? `missing:${normalizedTargets[i] ?? ''}`);
  }

  return hashString(parts.join('|'));
};

export { computeInputsDigest };
