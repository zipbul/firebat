import type { FileIndexRepository } from '../../ports/file-index.repository';

import { hashString } from '../../engine/hasher';
import { runWithConcurrency } from '../../engine/promise-pool';

const normalizePath = (filePath: string): string => filePath.replaceAll('\\', '/');

interface ComputeInputsDigestInput {
  readonly projectKey: string;
  readonly targets: ReadonlyArray<string>;
  readonly fileIndexRepository: FileIndexRepository;
  readonly extraParts?: ReadonlyArray<string>;
}

const computeInputsDigest = async (input: ComputeInputsDigestInput): Promise<string> => {
  const normalizedTargets = [...input.targets].map(normalizePath).sort();
  const parts: string[] = [...(input.extraParts ?? [])];
  const partsByIndex: string[] = new Array<string>(normalizedTargets.length);
  const concurrency = Math.max(1, Math.min(16, normalizedTargets.length));

  await runWithConcurrency(
    normalizedTargets.map((filePath, index) => ({ filePath, index })),
    concurrency,
    async item => {
      const { filePath, index } = item;

      try {
        const entry = await input.fileIndexRepository.getFile({ projectKey: input.projectKey, filePath });

        if (entry) {
          partsByIndex[index] = `file:${filePath}:${entry.contentHash}`;

          return;
        }

        const filePathAbs = filePath;
        const file = Bun.file(filePathAbs);
        const [stats, content] = await Promise.all([file.stat(), file.text()]);
        const contentHash = hashString(content);

        await input.fileIndexRepository.upsertFile({
          projectKey: input.projectKey,
          filePath,
          mtimeMs: stats.mtimeMs,
          size: stats.size,
          contentHash,
        });

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
