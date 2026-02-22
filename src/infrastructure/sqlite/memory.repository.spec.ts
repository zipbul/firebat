import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { createDrizzleDb } from './drizzle-db';
import { createSqliteMemoryRepository } from './memory.repository';

let db: Database;
let repo: ReturnType<typeof createSqliteMemoryRepository>;

const PROJECT_KEY = 'test-project';

beforeEach(() => {
  db = new Database(':memory:');
  db.run(`
    CREATE TABLE IF NOT EXISTS memories (
      projectKey TEXT NOT NULL,
      memoryKey TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      payloadJson TEXT NOT NULL,
      PRIMARY KEY (projectKey, memoryKey)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_memories_projectKey ON memories(projectKey)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_memories_updatedAt ON memories(updatedAt)`);
  const orm = createDrizzleDb(db);
  repo = createSqliteMemoryRepository(orm);
});

afterEach(() => {
  db.close();
});

describe('infrastructure/sqlite/memory.repository — listKeys', () => {
  it('returns empty array when no records exist', async () => {
    const keys = await repo.listKeys({ projectKey: PROJECT_KEY });
    expect(Array.isArray(keys)).toBe(true);
    expect(keys.length).toBe(0);
  });

  it('returns keys after writes, ordered by updatedAt desc', async () => {
    await repo.write({ projectKey: PROJECT_KEY, memoryKey: 'key-a', payloadJson: '{"a":1}' });
    await new Promise(r => setTimeout(r, 5));
    await repo.write({ projectKey: PROJECT_KEY, memoryKey: 'key-b', payloadJson: '{"b":2}' });
    const keys = await repo.listKeys({ projectKey: PROJECT_KEY });
    expect(keys.length).toBe(2);
    expect(keys[0]!.memoryKey).toBe('key-b');
    expect(keys[1]!.memoryKey).toBe('key-a');
  });

  it('only returns keys for the given projectKey', async () => {
    await repo.write({ projectKey: PROJECT_KEY, memoryKey: 'key-a', payloadJson: '{}' });
    await repo.write({ projectKey: 'other-project', memoryKey: 'key-b', payloadJson: '{}' });
    const keys = await repo.listKeys({ projectKey: PROJECT_KEY });
    expect(keys.length).toBe(1);
    expect(keys[0]!.memoryKey).toBe('key-a');
  });
});

describe('infrastructure/sqlite/memory.repository — read', () => {
  it('returns null for missing key', async () => {
    const result = await repo.read({ projectKey: PROJECT_KEY, memoryKey: 'nonexistent' });
    expect(result).toBeNull();
  });

  it('returns stored record after write', async () => {
    await repo.write({ projectKey: PROJECT_KEY, memoryKey: 'my-key', payloadJson: '{"data":99}' });
    const record = await repo.read({ projectKey: PROJECT_KEY, memoryKey: 'my-key' });
    expect(record).not.toBeNull();
    expect(record?.memoryKey).toBe('my-key');
    expect(record?.payloadJson).toBe('{"data":99}');
  });

  it('preserves createdAt on subsequent writes (upsert)', async () => {
    await repo.write({ projectKey: PROJECT_KEY, memoryKey: 'key', payloadJson: '{"v":1}' });
    const before = await repo.read({ projectKey: PROJECT_KEY, memoryKey: 'key' });
    await new Promise(r => setTimeout(r, 5));
    await repo.write({ projectKey: PROJECT_KEY, memoryKey: 'key', payloadJson: '{"v":2}' });
    const after = await repo.read({ projectKey: PROJECT_KEY, memoryKey: 'key' });
    expect(before?.createdAt).toBe(after?.createdAt);
    expect(after?.payloadJson).toBe('{"v":2}');
    expect(after!.updatedAt).toBeGreaterThanOrEqual(before!.updatedAt);
  });
});

describe('infrastructure/sqlite/memory.repository — delete', () => {
  it('delete removes existing record', async () => {
    await repo.write({ projectKey: PROJECT_KEY, memoryKey: 'key-del', payloadJson: '{}' });
    await repo.delete({ projectKey: PROJECT_KEY, memoryKey: 'key-del' });
    const result = await repo.read({ projectKey: PROJECT_KEY, memoryKey: 'key-del' });
    expect(result).toBeNull();
  });

  it('delete on nonexistent key does not throw', async () => {
    await expect(repo.delete({ projectKey: PROJECT_KEY, memoryKey: 'ghost' })).resolves.toBeUndefined();
  });
});
