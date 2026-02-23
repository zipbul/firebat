import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test';
import * as path from 'node:path';

const __origFirebatDb = { ...require(path.resolve(import.meta.dir, '../../infrastructure/sqlite/firebat.db.ts')) };
const __origMemoryStore = { ...require(path.resolve(import.meta.dir, '../../store/memory.ts')) };

// mock SQLite DB to avoid filesystem side effects
mock.module(path.resolve(import.meta.dir, '../../infrastructure/sqlite/firebat.db.ts'), () => ({
  getDb: async () => ({}),
}));

mock.module(path.resolve(import.meta.dir, '../../store/memory.ts'), () => {
  // In-memory store for tests
  const store = new Map<string, string>();
  return {
    createMemoryStore: () => ({
      listKeys: ({ projectKey }: { projectKey: string }) => {
        const entries: Array<{ memoryKey: string; updatedAt: number }> = [];
        for (const [k] of store.entries()) {
          if (k.startsWith(`${projectKey}:`)) {
            entries.push({ memoryKey: k.slice(projectKey.length + 1), updatedAt: 0 });
          }
        }
        return entries;
      },
      read: ({ projectKey, memoryKey }: { projectKey: string; memoryKey: string }) => {
        const key = `${projectKey}:${memoryKey}`;
        const val = store.get(key);
        if (!val) return null;
        return { projectKey, memoryKey, payloadJson: val, createdAt: 0, updatedAt: 0 };
      },
      write: ({ projectKey, memoryKey, payloadJson }: { projectKey: string; memoryKey: string; payloadJson: string }) => {
        store.set(`${projectKey}:${memoryKey}`, payloadJson);
      },
      delete: ({ projectKey, memoryKey }: { projectKey: string; memoryKey: string }) => {
        store.delete(`${projectKey}:${memoryKey}`);
      },
    }),
  };
});

import {
  listMemoriesUseCase,
  readMemoryUseCase,
  writeMemoryUseCase,
  deleteMemoryUseCase,
} from './memory.usecases';
import { createNoopLogger } from '../../ports/logger';

const logger = createNoopLogger();

afterEach(() => {
  // The module-level repoPromisesByProjectKey cache is hard to reset across tests
  // without re-importing. Our mock store is also module-level, so tests must use
  // distinct roots (or keys) to avoid collisions.
});

describe('application/memory/memory.usecases — writeMemoryUseCase', () => {
  it('writes and reads back a value', async () => {
    const root = path.join(process.cwd(), 'test-mem-write');
    await writeMemoryUseCase({ root, memoryKey: 'k1', value: { count: 42 }, logger });
    const result = await readMemoryUseCase({ root, memoryKey: 'k1', logger });
    expect(result).not.toBeNull();
    expect(result?.memoryKey).toBe('k1');
    expect((result?.value as { count: number }).count).toBe(42);
  });

  it('value is serialized as JSON', async () => {
    const root = path.join(process.cwd(), 'test-mem-json');
    await writeMemoryUseCase({ root, memoryKey: 'k2', value: [1, 2, 3], logger });
    const result = await readMemoryUseCase({ root, memoryKey: 'k2', logger });
    expect(Array.isArray(result?.value)).toBe(true);
  });
});

describe('application/memory/memory.usecases — readMemoryUseCase', () => {
  it('returns null for non-existent key', async () => {
    const root = path.join(process.cwd(), 'test-mem-read');
    const result = await readMemoryUseCase({ root, memoryKey: 'nonexistent', logger });
    expect(result).toBeNull();
  });
});

describe('application/memory/memory.usecases — listMemoriesUseCase', () => {
  it('returns empty array when no memories exist', async () => {
    const root = path.join(process.cwd(), 'test-mem-list');
    const result = await listMemoriesUseCase({ root, logger });
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns entries after write', async () => {
    const root = path.join(process.cwd(), 'test-mem-list2');
    await writeMemoryUseCase({ root, memoryKey: 'item-a', value: 'hello', logger });
    const result = await listMemoriesUseCase({ root, logger });
    const keys = result.map(r => r.memoryKey);
    expect(keys).toContain('item-a');
  });
});

describe('application/memory/memory.usecases — deleteMemoryUseCase', () => {
  it('delete removes an existing memory', async () => {
    const root = path.join(process.cwd(), 'test-mem-del');
    await writeMemoryUseCase({ root, memoryKey: 'del-key', value: 99, logger });
    await deleteMemoryUseCase({ root, memoryKey: 'del-key', logger });
    const result = await readMemoryUseCase({ root, memoryKey: 'del-key', logger });
    expect(result).toBeNull();
  });

  it('delete on nonexistent key resolves without error', async () => {
    const root = path.join(process.cwd(), 'test-mem-del2');
    await expect(deleteMemoryUseCase({ root, memoryKey: 'ghost', logger })).resolves.toBeUndefined();
  });
});

afterAll(() => {
  mock.restore();
  mock.module(path.resolve(import.meta.dir, '../../infrastructure/sqlite/firebat.db.ts'), () => __origFirebatDb);
  mock.module(path.resolve(import.meta.dir, '../../store/memory.ts'), () => __origMemoryStore);
});
