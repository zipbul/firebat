import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { type MemoryStore, createMemoryStore } from './memory';

describe('createMemoryStore', () => {
  let db: Database;
  let store: MemoryStore;
  let dateNowSpy: ReturnType<typeof spyOn>;
  let nowValue: number;

  beforeEach(() => {
    db = new Database(':memory:');
    nowValue = 1_700_000_000_000;
    dateNowSpy = spyOn(Date, 'now').mockImplementation(() => nowValue);
    store = createMemoryStore(db);
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
    db.close();
  });

  // ---------- HP ----------

  it('should return empty array when project has no entries', () => {
    const result = store.listKeys({ projectKey: 'proj' });

    expect(result).toEqual([]);
  });

  it('should return entries sorted by updatedAt DESC when listing keys', () => {
    nowValue = 1000;
    store.write({ projectKey: 'proj', memoryKey: 'older', payloadJson: '{}' });
    nowValue = 2000;
    store.write({ projectKey: 'proj', memoryKey: 'newer', payloadJson: '{}' });

    const result = store.listKeys({ projectKey: 'proj' });

    expect(result).toEqual([
      { memoryKey: 'newer', updatedAt: 2000 },
      { memoryKey: 'older', updatedAt: 1000 },
    ]);
  });

  it('should return only entries for given projectKey when listing keys', () => {
    store.write({ projectKey: 'proj-a', memoryKey: 'key1', payloadJson: '{}' });
    store.write({ projectKey: 'proj-b', memoryKey: 'key2', payloadJson: '{}' });

    const result = store.listKeys({ projectKey: 'proj-a' });

    expect(result).toHaveLength(1);
    expect(result[0]!.memoryKey).toBe('key1');
  });

  it('should return null when key does not exist', () => {
    const result = store.read({ projectKey: 'proj', memoryKey: 'missing' });

    expect(result).toBeNull();
  });

  it('should return MemoryRecord with all fields when key exists', () => {
    store.write({ projectKey: 'proj', memoryKey: 'k1', payloadJson: '{"x":1}' });

    const result = store.read({ projectKey: 'proj', memoryKey: 'k1' });

    expect(result).toEqual({
      projectKey: 'proj',
      memoryKey: 'k1',
      createdAt: nowValue,
      updatedAt: nowValue,
      payloadJson: '{"x":1}',
    });
  });

  it('should create new record with createdAt equal to updatedAt when writing new key', () => {
    nowValue = 5000;
    store.write({ projectKey: 'proj', memoryKey: 'new', payloadJson: '{}' });

    const record = store.read({ projectKey: 'proj', memoryKey: 'new' });

    expect(record!.createdAt).toBe(5000);
    expect(record!.updatedAt).toBe(5000);
  });

  it('should preserve original createdAt when updating existing record', () => {
    nowValue = 1000;
    store.write({ projectKey: 'proj', memoryKey: 'k', payloadJson: '{"v":1}' });

    nowValue = 2000;
    store.write({ projectKey: 'proj', memoryKey: 'k', payloadJson: '{"v":2}' });

    const record = store.read({ projectKey: 'proj', memoryKey: 'k' });

    expect(record!.createdAt).toBe(1000);
    expect(record!.updatedAt).toBe(2000);
    expect(record!.payloadJson).toBe('{"v":2}');
  });

  it('should remove existing key when deleting', () => {
    store.write({ projectKey: 'proj', memoryKey: 'k', payloadJson: '{}' });
    store.delete({ projectKey: 'proj', memoryKey: 'k' });

    const result = store.read({ projectKey: 'proj', memoryKey: 'k' });

    expect(result).toBeNull();
  });

  it('should be no-op when deleting non-existent key', () => {
    // Should not throw
    store.delete({ projectKey: 'proj', memoryKey: 'ghost' });

    const result = store.read({ projectKey: 'proj', memoryKey: 'ghost' });

    expect(result).toBeNull();
  });

  // ---------- NE ----------

  it('should be safe against SQL injection in key fields when using prepared statements', () => {
    const malicious = "'; DROP TABLE memories; --";

    store.write({ projectKey: malicious, memoryKey: malicious, payloadJson: 'safe' });
    const result = store.read({ projectKey: malicious, memoryKey: malicious });

    expect(result!.payloadJson).toBe('safe');
    // Table still exists
    const count = db.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number };
    expect(count.c).toBeGreaterThanOrEqual(1);
  });

  it('should assign new createdAt when writing after delete of same key', () => {
    nowValue = 1000;
    store.write({ projectKey: 'proj', memoryKey: 'k', payloadJson: '{"v":1}' });

    store.delete({ projectKey: 'proj', memoryKey: 'k' });

    nowValue = 5000;
    store.write({ projectKey: 'proj', memoryKey: 'k', payloadJson: '{"v":2}' });

    const record = store.read({ projectKey: 'proj', memoryKey: 'k' });

    expect(record!.createdAt).toBe(5000);
    expect(record!.updatedAt).toBe(5000);
    expect(record!.payloadJson).toBe('{"v":2}');
  });

  // ---------- ED ----------

  it('should handle empty string projectKey and memoryKey correctly', () => {
    store.write({ projectKey: '', memoryKey: '', payloadJson: '{"empty":true}' });

    const result = store.read({ projectKey: '', memoryKey: '' });

    expect(result!.payloadJson).toBe('{"empty":true}');
  });

  it('should store and return empty string payloadJson as-is', () => {
    store.write({ projectKey: 'proj', memoryKey: 'k', payloadJson: '' });

    const result = store.read({ projectKey: 'proj', memoryKey: 'k' });

    expect(result!.payloadJson).toBe('');
  });

  it('should store payloadJson as raw string without JSON validation', () => {
    const notJson = 'this is not json at all <<<>>>';

    store.write({ projectKey: 'proj', memoryKey: 'k', payloadJson: notJson });

    const result = store.read({ projectKey: 'proj', memoryKey: 'k' });

    expect(result!.payloadJson).toBe(notJson);
  });

  // ---------- CO ----------

  it('should share data between two stores on same DB', () => {
    const store2 = createMemoryStore(db);

    store.write({ projectKey: 'proj', memoryKey: 'shared', payloadJson: '{"s":1}' });

    const result = store2.read({ projectKey: 'proj', memoryKey: 'shared' });

    expect(result!.payloadJson).toBe('{"s":1}');
  });

  it('should apply last-write-wins when same key written from different stores', () => {
    const store2 = createMemoryStore(db);

    nowValue = 1000;
    store.write({ projectKey: 'proj', memoryKey: 'k', payloadJson: 'from-store1' });

    nowValue = 2000;
    store2.write({ projectKey: 'proj', memoryKey: 'k', payloadJson: 'from-store2' });

    const result = store.read({ projectKey: 'proj', memoryKey: 'k' });

    expect(result!.payloadJson).toBe('from-store2');
  });

  // ---------- ID ----------

  it('should create schema idempotently when called twice on same DB', () => {
    const store2 = createMemoryStore(db);

    store.write({ projectKey: 'proj', memoryKey: 'k', payloadJson: '{}' });
    const result = store2.read({ projectKey: 'proj', memoryKey: 'k' });

    expect(result!.payloadJson).toBe('{}');
  });

  it('should return same result when same key and payload is written twice', () => {
    store.write({ projectKey: 'proj', memoryKey: 'k', payloadJson: '{"dup":1}' });
    store.write({ projectKey: 'proj', memoryKey: 'k', payloadJson: '{"dup":1}' });

    const result = store.read({ projectKey: 'proj', memoryKey: 'k' });

    expect(result!.payloadJson).toBe('{"dup":1}');
  });

  // ---------- OR ----------

  it('should return entries with latest updatedAt first when listing keys after sequential writes', () => {
    nowValue = 100;
    store.write({ projectKey: 'proj', memoryKey: 'first', payloadJson: '{}' });
    nowValue = 200;
    store.write({ projectKey: 'proj', memoryKey: 'second', payloadJson: '{}' });
    nowValue = 300;
    store.write({ projectKey: 'proj', memoryKey: 'third', payloadJson: '{}' });

    const keys = store.listKeys({ projectKey: 'proj' }).map((e) => e.memoryKey);

    expect(keys).toEqual(['third', 'second', 'first']);
  });

  it('should return last written value when same key is written multiple times', () => {
    store.write({ projectKey: 'proj', memoryKey: 'k', payloadJson: 'v1' });
    store.write({ projectKey: 'proj', memoryKey: 'k', payloadJson: 'v2' });
    store.write({ projectKey: 'proj', memoryKey: 'k', payloadJson: 'v3' });

    const result = store.read({ projectKey: 'proj', memoryKey: 'k' });

    expect(result!.payloadJson).toBe('v3');
  });
});
