import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { type ArtifactStore, type GetArtifactInput, type SetArtifactInput, createArtifactStore } from './artifact';

describe('createArtifactStore', () => {
  let db: Database;
  let store: ArtifactStore;
  let dateNowSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    db = new Database(':memory:');
    dateNowSpy = spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    store = createArtifactStore(db);
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
    db.close();
  });

  const makeGet = (overrides?: Partial<GetArtifactInput>): GetArtifactInput => ({
    projectKey: 'proj',
    kind: 'ast',
    artifactKey: 'file.ts',
    inputsDigest: 'abc123',
    ...overrides,
  });

  const makeSet = <T>(value: T, overrides?: Partial<GetArtifactInput>): SetArtifactInput<T> => ({
    ...makeGet(overrides),
    value,
  });

  // ---------- HP ----------

  it('should return stored object via L1 cache hit when value was previously set', () => {
    const value = { code: 42, items: [1, 2, 3] };

    store.set(makeSet(value));
    const result = store.get(makeGet());

    expect(result).toEqual(value);
  });

  it('should return value from L2 and populate L1 when L1 cache is empty', () => {
    db.run(
      'INSERT INTO artifacts (projectKey, kind, artifactKey, inputsDigest, createdAt, payloadJson) VALUES (?, ?, ?, ?, ?, ?)',
      ['proj', 'ast', 'file.ts', 'abc123', 1000, '{"x":1}'],
    );

    const result = store.get<{ x: number }>(makeGet());

    expect(result).toEqual({ x: 1 });
  });

  it('should return null when key does not exist in L1 or L2', () => {
    const result = store.get(makeGet());

    expect(result).toBeNull();
  });

  it('should overwrite existing value when set is called with same key', () => {
    store.set(makeSet({ v: 1 }));
    store.set(makeSet({ v: 2 }));

    const result = store.get<{ v: number }>(makeGet());

    expect(result).toEqual({ v: 2 });
  });

  it('should store and retrieve different keys independently', () => {
    store.set(makeSet('alpha', { artifactKey: 'a.ts' }));
    store.set(makeSet('beta', { artifactKey: 'b.ts' }));

    expect(store.get<string>(makeGet({ artifactKey: 'a.ts' }))).toBe('alpha');
    expect(store.get<string>(makeGet({ artifactKey: 'b.ts' }))).toBe('beta');
  });

  // ---------- NE ----------

  it('should fall through to L2 when L1 cache has corrupt JSON', () => {
    // Insert corrupt JSON → first get populates L1 with corrupt from L2
    db.run(
      'INSERT INTO artifacts (projectKey, kind, artifactKey, inputsDigest, createdAt, payloadJson) VALUES (?, ?, ?, ?, ?, ?)',
      ['proj', 'ast', 'file.ts', 'abc123', 1000, '{corrupt'],
    );
    store.get(makeGet()); // L1 now has corrupt JSON from L2

    // Fix L2 to have valid JSON
    db.run(
      'UPDATE artifacts SET payloadJson = ? WHERE projectKey = ? AND kind = ? AND artifactKey = ? AND inputsDigest = ?',
      ['{"fixed":true}', 'proj', 'ast', 'file.ts', 'abc123'],
    );

    // L1 corrupt → catch → delete → L2 (now valid) → returns value
    const result = store.get<{ fixed: boolean }>(makeGet());

    expect(result).toEqual({ fixed: true });
  });

  it('should return null when L2 has corrupt JSON', () => {
    db.run(
      'INSERT INTO artifacts (projectKey, kind, artifactKey, inputsDigest, createdAt, payloadJson) VALUES (?, ?, ?, ?, ?, ?)',
      ['proj', 'ast', 'file.ts', 'abc123', 1000, 'not-valid-json'],
    );

    const result = store.get(makeGet());

    expect(result).toBeNull();
  });

  it('should return null when both L1 and L2 have corrupt JSON', () => {
    db.run(
      'INSERT INTO artifacts (projectKey, kind, artifactKey, inputsDigest, createdAt, payloadJson) VALUES (?, ?, ?, ?, ?, ?)',
      ['proj', 'ast', 'file.ts', 'abc123', 1000, '<<<invalid>>>'],
    );
    // First get: L1 miss → L2 hit → populate L1 with corrupt → parse fail → null
    store.get(makeGet());

    // Second get: L1 has corrupt → catch → delete → L2 still corrupt → null
    const result = store.get(makeGet());

    expect(result).toBeNull();
  });

  // ---------- ED ----------

  it('should handle empty string key fields correctly', () => {
    const emptyKey = { projectKey: '', kind: '', artifactKey: '', inputsDigest: '' };

    store.set({ ...emptyKey, value: 'ok' });
    const result = store.get<string>(emptyKey);

    expect(result).toBe('ok');
  });

  it('should return 0 without confusing with null when value is zero', () => {
    store.set(makeSet(0));

    const result = store.get<number>(makeGet());

    expect(result).toBe(0);
  });

  it('should return false without confusing with null when value is false', () => {
    store.set(makeSet(false));

    const result = store.get<boolean>(makeGet());

    expect(result).toBe(false);
  });

  it('should return empty string without confusing with null when value is empty string', () => {
    store.set(makeSet(''));

    const result = store.get<string>(makeGet());

    expect(result).toBe('');
  });

  it('should return empty array when value is empty array', () => {
    store.set(makeSet([]));

    const result = store.get<unknown[]>(makeGet());

    expect(result).toEqual([]);
  });

  it('should return empty object when value is empty object', () => {
    store.set(makeSet({}));

    const result = store.get<Record<string, unknown>>(makeGet());

    expect(result).toEqual({});
  });

  it('should return null when value was set as null', () => {
    store.set(makeSet(null));

    const result = store.get(makeGet());

    expect(result).toBeNull();
  });

  // ---------- CO ----------

  it('should exhibit L1 cache collision when key fields contain null byte separator', () => {
    // cacheKey joins fields with \0 — if field values contain \0, different inputs collide
    const key1: GetArtifactInput = { projectKey: 'a\0b', kind: 'c', artifactKey: 'd', inputsDigest: 'e' };
    const key2: GetArtifactInput = { projectKey: 'a', kind: 'b\0c', artifactKey: 'd', inputsDigest: 'e' };

    store.set({ ...key1, value: 'from-key1' });
    store.set({ ...key2, value: 'from-key2' });

    // Both produce identical cacheKey → L1 collision: get(key1) returns key2's value
    const result = store.get<string>(key1);

    expect(result).toBe('from-key2');
  });

  it('should share L2 data between multiple stores on same DB with separate L1', () => {
    const store2 = createArtifactStore(db);

    store.set(makeSet({ shared: true }));
    // store2 has empty L1 but shares L2
    const result = store2.get<{ shared: boolean }>(makeGet());

    expect(result).toEqual({ shared: true });
  });

  it('should be safe against SQL injection in key fields when using prepared statements', () => {
    const malicious = "'; DROP TABLE artifacts; --";

    store.set(makeSet('safe', { projectKey: malicious }));
    const result = store.get<string>(makeGet({ projectKey: malicious }));

    expect(result).toBe('safe');
    // Table still exists
    const count = db.prepare('SELECT COUNT(*) as c FROM artifacts').get() as { c: number };
    expect(count.c).toBeGreaterThanOrEqual(1);
  });

  // ---------- ID ----------

  it('should create schema idempotently when called twice on same DB', () => {
    // createArtifactStore already called in beforeEach; calling again should not error
    const store2 = createArtifactStore(db);

    store.set(makeSet('first'));
    const result = store2.get<string>(makeGet());

    expect(result).toBe('first');
  });

  it('should return same result when same key and value is set twice', () => {
    store.set(makeSet({ data: 'same' }));
    store.set(makeSet({ data: 'same' }));

    const result = store.get<{ data: string }>(makeGet());

    expect(result).toEqual({ data: 'same' });
  });

  // ---------- OR ----------

  it('should return last written value when same key is set multiple times', () => {
    store.set(makeSet('first'));
    store.set(makeSet('second'));
    store.set(makeSet('third'));

    const result = store.get<string>(makeGet());

    expect(result).toBe('third');
  });
});
