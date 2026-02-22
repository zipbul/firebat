import { describe, it, expect } from 'bun:test';

import type {
  MemoryRepository,
  ListMemoryKeysInput,
  ReadMemoryInput,
  WriteMemoryInput,
  DeleteMemoryInput,
} from './memory.repository';

describe('MemoryRepository (in-memory implementation)', () => {
  type StoredRecord = {
    projectKey: string;
    memoryKey: string;
    payloadJson: string;
    createdAt: number;
    updatedAt: number;
  };

  const makeRepo = (): MemoryRepository => {
    const records = new Map<string, StoredRecord>();
    const key = (input: { projectKey: string; memoryKey: string }) =>
      `${input.projectKey}:${input.memoryKey}`;

    return {
      async listKeys({ projectKey }: ListMemoryKeysInput) {
        return [...records.values()]
          .filter(r => r.projectKey === projectKey)
          .map(r => ({ memoryKey: r.memoryKey, updatedAt: r.updatedAt }));
      },
      async read({ projectKey, memoryKey }: ReadMemoryInput) {
        return records.get(key({ projectKey, memoryKey })) ?? null;
      },
      async write({ projectKey, memoryKey, payloadJson }: WriteMemoryInput) {
        const now = Date.now();
        const existing = records.get(key({ projectKey, memoryKey }));
        records.set(key({ projectKey, memoryKey }), {
          projectKey,
          memoryKey,
          payloadJson,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        });
      },
      async delete({ projectKey, memoryKey }: DeleteMemoryInput) {
        records.delete(key({ projectKey, memoryKey }));
      },
    };
  };

  it('[HP] listKeys returns empty array initially', async () => {
    const repo = makeRepo();
    const keys = await repo.listKeys({ projectKey: 'p' });
    expect(keys).toEqual([]);
  });

  it('[HP] write then read returns stored record', async () => {
    const repo = makeRepo();
    await repo.write({ projectKey: 'p', memoryKey: 'k', payloadJson: '{"x":1}' });
    const record = await repo.read({ projectKey: 'p', memoryKey: 'k' });
    expect(record?.payloadJson).toBe('{"x":1}');
    expect(record?.memoryKey).toBe('k');
  });

  it('[HP] read returns null for non-existent key', async () => {
    const repo = makeRepo();
    const result = await repo.read({ projectKey: 'p', memoryKey: 'missing' });
    expect(result).toBeNull();
  });

  it('[HP] listKeys returns written keys', async () => {
    const repo = makeRepo();
    await repo.write({ projectKey: 'p', memoryKey: 'k1', payloadJson: 'a' });
    await repo.write({ projectKey: 'p', memoryKey: 'k2', payloadJson: 'b' });
    const keys = await repo.listKeys({ projectKey: 'p' });
    expect(keys.map(k => k.memoryKey).sort()).toEqual(['k1', 'k2']);
  });

  it('[HP] delete removes the record', async () => {
    const repo = makeRepo();
    await repo.write({ projectKey: 'p', memoryKey: 'k', payloadJson: 'x' });
    await repo.delete({ projectKey: 'p', memoryKey: 'k' });
    const record = await repo.read({ projectKey: 'p', memoryKey: 'k' });
    expect(record).toBeNull();
  });
});
