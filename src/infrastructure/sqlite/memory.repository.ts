import { and, desc, eq } from 'drizzle-orm';

import type { MemoryKeyEntry, MemoryRecord, MemoryRepository } from '../../ports/memory.repository';
import type { FirebatDrizzleDb } from './drizzle-db';

import { memories } from './schema';

const createSqliteMemoryRepository = (db: FirebatDrizzleDb): MemoryRepository => {
  return {
    async listKeys({ projectKey }): Promise<ReadonlyArray<MemoryKeyEntry>> {
      const rows = db
        .select({ memoryKey: memories.memoryKey, updatedAt: memories.updatedAt })
        .from(memories)
        .where(eq(memories.projectKey, projectKey))
        .orderBy(desc(memories.updatedAt))
        .all();

      return Promise.resolve(rows);
    },

    async read({ projectKey, memoryKey }): Promise<MemoryRecord | null> {
      const row = db
        .select({
          projectKey: memories.projectKey,
          memoryKey: memories.memoryKey,
          createdAt: memories.createdAt,
          updatedAt: memories.updatedAt,
          payloadJson: memories.payloadJson,
        })
        .from(memories)
        .where(and(eq(memories.projectKey, projectKey), eq(memories.memoryKey, memoryKey)))
        .get();

      return Promise.resolve(row ?? null);
    },

    async write({ projectKey, memoryKey, payloadJson }): Promise<void> {
      const now = Date.now();
      // Retry logic for DB busy/locked scenarios
      const maxRetries = 3;
      let lastError: Error | null = null;

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const existing = db
            .select({ createdAt: memories.createdAt })
            .from(memories)
            .where(and(eq(memories.projectKey, projectKey), eq(memories.memoryKey, memoryKey)))
            .get();
          const createdAt = existing?.createdAt ?? now;

          db.insert(memories)
            .values({ projectKey, memoryKey, createdAt, updatedAt: now, payloadJson })
            .onConflictDoUpdate({
              target: [memories.projectKey, memories.memoryKey],
              set: { updatedAt: now, payloadJson },
            })
            .run();

          return Promise.resolve();
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));

          const errMsg = lastError.message.toLowerCase();

          // Retry on busy/locked errors
          if ((errMsg.includes('busy') || errMsg.includes('locked')) && attempt < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));

            continue;
          }

          throw lastError;
        }
      }

      throw lastError ?? new Error('Write failed after retries');
    },

    async delete({ projectKey, memoryKey }): Promise<void> {
      db.delete(memories)
        .where(and(eq(memories.projectKey, projectKey), eq(memories.memoryKey, memoryKey)))
        .run();

      return Promise.resolve();
    },
  };
};

export { createSqliteMemoryRepository };
