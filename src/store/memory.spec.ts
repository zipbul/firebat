import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { restoreAndClose } from '../../test/integration/shared/test-kit';
import { type MemoryStore, createMemoryStore } from './memory';

interface PayloadRoundtripCase {
  readonly name: string;
  readonly projectKey: string;
  readonly memoryKey: string;
  readonly payloadJson: string;
}

interface CrossStoreCase {
  readonly name: string;
  readonly payloadJson: string;
}

interface WriteInput {
  readonly projectKey: string;
  readonly memoryKey: string;
  readonly payloadJson: string;
}

interface DeleteCase {
  readonly name: string;
  readonly memoryKey: string;
  readonly seeds: ReadonlyArray<WriteInput>;
}

/** Assert a record's createdAt and updatedAt both equal `ts`. */
const expectTimestamps = (
  record: { readonly createdAt: number; readonly updatedAt: number } | null | undefined,
  ts: number,
): void => {
  expect(record!.createdAt).toBe(ts);
  expect(record!.updatedAt).toBe(ts);
};

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

  afterEach(() => restoreAndClose(dateNowSpy, db));

  const writeAt = (ts: number, input: WriteInput): void => {
    nowValue = ts;

    store.write(input);
  };

  // ---------- HP ----------

  it('should return empty array when project has no entries', () => {
    const result = store.listKeys({ projectKey: 'proj' });

    expect(result).toEqual([]);
  });

  it('should return entries sorted by updatedAt DESC when listing keys', () => {
    writeAt(1000, { projectKey: 'proj', memoryKey: 'older', payloadJson: '{}' });
    writeAt(2000, { projectKey: 'proj', memoryKey: 'newer', payloadJson: '{}' });

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
    writeAt(5000, { projectKey: 'proj', memoryKey: 'new', payloadJson: '{}' });

    const record = store.read({ projectKey: 'proj', memoryKey: 'new' });

    expectTimestamps(record, 5000);
  });

  it('should preserve original createdAt when updating existing record', () => {
    writeAt(1000, { projectKey: 'proj', memoryKey: 'k', payloadJson: '{"v":1}' });
    writeAt(2000, { projectKey: 'proj', memoryKey: 'k', payloadJson: '{"v":2}' });

    const record = store.read({ projectKey: 'proj', memoryKey: 'k' });

    expect(record!.createdAt).toBe(1000);
    expect(record!.updatedAt).toBe(2000);
    expect(record!.payloadJson).toBe('{"v":2}');
  });

  const deleteCases: DeleteCase[] = [
    { name: 'removing an existing key', memoryKey: 'k', seeds: [{ projectKey: 'proj', memoryKey: 'k', payloadJson: '{}' }] },
    { name: 'a no-op when the key does not exist', memoryKey: 'ghost', seeds: [] },
  ];

  it.each(deleteCases)('should leave no readable record after $name', ({ memoryKey, seeds }) => {
    for (const seed of seeds) {
      store.write(seed);
    }

    store.delete({ projectKey: 'proj', memoryKey });

    const result = store.read({ projectKey: 'proj', memoryKey });

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
    writeAt(1000, { projectKey: 'proj', memoryKey: 'k', payloadJson: '{"v":1}' });

    store.delete({ projectKey: 'proj', memoryKey: 'k' });

    writeAt(5000, { projectKey: 'proj', memoryKey: 'k', payloadJson: '{"v":2}' });

    const record = store.read({ projectKey: 'proj', memoryKey: 'k' });

    expectTimestamps(record, 5000);
    expect(record!.payloadJson).toBe('{"v":2}');
  });

  // ---------- ED ----------

  const payloadRoundtripCases: PayloadRoundtripCase[] = [
    { name: 'empty string projectKey and memoryKey', projectKey: '', memoryKey: '', payloadJson: '{"empty":true}' },
    { name: 'empty string payloadJson', projectKey: 'proj', memoryKey: 'k', payloadJson: '' },
    {
      name: 'raw string without JSON validation',
      projectKey: 'proj',
      memoryKey: 'k',
      payloadJson: 'this is not json at all <<<>>>',
    },
  ];

  it.each(payloadRoundtripCases)(
    'should store and return payloadJson as-is for $name',
    ({ projectKey, memoryKey, payloadJson }) => {
      store.write({ projectKey, memoryKey, payloadJson });

      const result = store.read({ projectKey, memoryKey });

      expect(result!.payloadJson).toBe(payloadJson);
    },
  );

  // ---------- CO ----------

  const crossStoreCases: CrossStoreCase[] = [
    { name: 'sharing data between two stores on same DB', payloadJson: '{"s":1}' },
    { name: 'creating schema idempotently when called twice on same DB', payloadJson: '{}' },
  ];

  it.each(crossStoreCases)('should read a value written via a sibling store when $name', ({ payloadJson }) => {
    const store2 = createMemoryStore(db);

    store.write({ projectKey: 'proj', memoryKey: 'shared', payloadJson });

    const result = store2.read({ projectKey: 'proj', memoryKey: 'shared' });

    expect(result!.payloadJson).toBe(payloadJson);
  });

  it('should apply last-write-wins when same key written from different stores', () => {
    const store2 = createMemoryStore(db);

    writeAt(1000, { projectKey: 'proj', memoryKey: 'k', payloadJson: 'from-store1' });

    nowValue = 2000;

    store2.write({ projectKey: 'proj', memoryKey: 'k', payloadJson: 'from-store2' });

    const result = store.read({ projectKey: 'proj', memoryKey: 'k' });

    expect(result!.payloadJson).toBe('from-store2');
  });

  // ---------- ID ----------

  it('should return same result when same key and payload is written twice', () => {
    store.write({ projectKey: 'proj', memoryKey: 'k', payloadJson: '{"dup":1}' });
    store.write({ projectKey: 'proj', memoryKey: 'k', payloadJson: '{"dup":1}' });

    const result = store.read({ projectKey: 'proj', memoryKey: 'k' });

    expect(result!.payloadJson).toBe('{"dup":1}');
  });

  // ---------- OR ----------

  it('should return entries with latest updatedAt first when listing keys after sequential writes', () => {
    writeAt(100, { projectKey: 'proj', memoryKey: 'first', payloadJson: '{}' });
    writeAt(200, { projectKey: 'proj', memoryKey: 'second', payloadJson: '{}' });
    writeAt(300, { projectKey: 'proj', memoryKey: 'third', payloadJson: '{}' });

    const keys = store.listKeys({ projectKey: 'proj' }).map(e => e.memoryKey);

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
