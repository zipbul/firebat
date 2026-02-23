import type { FileIndexStore } from '../../store/file-index';
import type { FirebatLogger } from '../../ports/logger';

import { hashString } from '../../engine/hasher';
import { runWithConcurrency } from '../../engine/promise-pool';

interface IndexTargetsInput {
  readonly projectKey: string;
  readonly targets: ReadonlyArray<string>;
  readonly repository: FileIndexStore;
  readonly concurrency?: number;
  readonly logger: FirebatLogger;
}

const indexTargets = async (input: IndexTargetsInput): Promise<void> => {
  const concurrency = input.concurrency ?? 8;
  const logger = input.logger;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  logger.debug('Indexing files', { targetCount: input.targets.length, concurrency });

  if (input.targets.length === 0) {
    logger.debug('Indexing done', { updated, skipped, failed });

    return;
  }

  await runWithConcurrency(input.targets, concurrency, async filePath => {
    const isEmptyPath = filePath.trim().length === 0;

    if (isEmptyPath) {
      failed += 1;
    }

    if (isEmptyPath) {
      return;
    }

    try {
      const file = Bun.file(filePath);
      const stats = await file.stat();
      const existing = input.repository.getFile({ projectKey: input.projectKey, filePath });
      const mtimeMs = stats.mtimeMs;
      const size = stats.size;

      if (existing && existing.mtimeMs === mtimeMs && existing.size === size) {
        skipped += 1;
      } else {
        const content = await file.text();
        const contentHash = hashString(content);

        input.repository.upsertFile({
          projectKey: input.projectKey,
          filePath,
          mtimeMs,
          size,
          contentHash,
        });

        updated += 1;

        logger.trace('Index upsert', { filePath, size, mtimeMs });
      }
    } catch {
      failed += 1;

      logger.warn('Index failed, entry removed', { filePath });

      input.repository.deleteFile({ projectKey: input.projectKey, filePath });
    }
  });

  logger.debug('Indexing done', { updated, skipped, failed });

  if (skipped > 0) {
    logger.trace('Index skip', { skipped });
  }
};

export { indexTargets };
