import { and, eq } from 'drizzle-orm';

import type { FileIndexEntry, FileIndexRepository } from '../../ports/file-index.repository';
import type { FirebatDrizzleDb } from './drizzle-db';

import { files } from './schema';

const createSqliteFileIndexRepository = (db: FirebatDrizzleDb): FileIndexRepository => {
  return {
    async getFile({ projectKey, filePath }): Promise<FileIndexEntry | null> {
      const row = db
        .select({
          filePath: files.filePath,
          mtimeMs: files.mtimeMs,
          size: files.size,
          contentHash: files.contentHash,
          updatedAt: files.updatedAt,
        })
        .from(files)
        .where(and(eq(files.projectKey, projectKey), eq(files.filePath, filePath)))
        .get();

      return Promise.resolve(row ?? null);
    },

    async upsertFile({ projectKey, filePath, mtimeMs, size, contentHash }): Promise<void> {
      const updatedAt = Date.now();

      db.insert(files)
        .values({
          projectKey,
          filePath,
          mtimeMs,
          size,
          contentHash,
          updatedAt,
        })
        .onConflictDoUpdate({
          target: [files.projectKey, files.filePath],
          set: { mtimeMs, size, contentHash, updatedAt },
        })
        .run();

      return Promise.resolve();
    },

    async deleteFile({ projectKey, filePath }): Promise<void> {
      db.delete(files)
        .where(and(eq(files.projectKey, projectKey), eq(files.filePath, filePath)))
        .run();

      return Promise.resolve();
    },
  };
};

export { createSqliteFileIndexRepository };
