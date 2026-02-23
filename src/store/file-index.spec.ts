import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { createFileIndexStore } from './file-index';
import type { FileIndexStore } from './file-index';

let db: Database;
let store: FileIndexStore;

const base = {
  projectKey: 'proj',
  filePath: '/src/a.ts',
  mtimeMs: 1000,
  size: 512,
  contentHash: 'abc123',
};

beforeEach(() => {
  db = new Database(':memory:');
  store = createFileIndexStore(db);
});

afterEach(() => {
  db.close();
});

describe('createFileIndexStore – Happy Path', () => {
  it('[HP-1] upsertFile 후 getFile → cache hit, 올바른 entry 반환', () => {
    store.upsertFile(base);
    const result = store.getFile({ projectKey: base.projectKey, filePath: base.filePath });
    expect(result).not.toBeNull();
    expect(result?.filePath).toBe(base.filePath);
    expect(result?.mtimeMs).toBe(base.mtimeMs);
    expect(result?.size).toBe(base.size);
    expect(result?.contentHash).toBe(base.contentHash);
  });

  it('[HP-2] upsert 전 getFile → null (cold cache + sqlite miss)', () => {
    const result = store.getFile({ projectKey: 'proj', filePath: '/src/a.ts' });
    expect(result).toBeNull();
  });

  it('[HP-3] upsert 후 다른 키로 getFile → null', () => {
    store.upsertFile(base);
    const result = store.getFile({ projectKey: 'proj', filePath: '/src/b.ts' });
    expect(result).toBeNull();
  });

  it('[HP-4] upsert 2회 동일 키 다른 값 → 최신값 반환', () => {
    store.upsertFile(base);
    store.upsertFile({ ...base, mtimeMs: 9999, size: 1024, contentHash: 'new' });
    const result = store.getFile({ projectKey: base.projectKey, filePath: base.filePath });
    expect(result?.mtimeMs).toBe(9999);
    expect(result?.size).toBe(1024);
    expect(result?.contentHash).toBe('new');
  });

  it('[HP-5] deleteFile 후 getFile → null', () => {
    store.upsertFile(base);
    store.deleteFile({ projectKey: base.projectKey, filePath: base.filePath });
    const result = store.getFile({ projectKey: base.projectKey, filePath: base.filePath });
    expect(result).toBeNull();
  });

  it('[HP-6] 전체 lifecycle: upsert→get→delete→get(null)→upsert→get', () => {
    store.upsertFile(base);
    expect(store.getFile({ projectKey: base.projectKey, filePath: base.filePath })).not.toBeNull();
    store.deleteFile({ projectKey: base.projectKey, filePath: base.filePath });
    expect(store.getFile({ projectKey: base.projectKey, filePath: base.filePath })).toBeNull();
    store.upsertFile({ ...base, mtimeMs: 2000 });
    const result = store.getFile({ projectKey: base.projectKey, filePath: base.filePath });
    expect(result?.mtimeMs).toBe(2000);
  });

  it('[HP-7] 동일 projectKey 다른 filePath 여러 개 → 각각 독립', () => {
    const a = { ...base, filePath: '/src/a.ts', contentHash: 'hashA' };
    const b = { ...base, filePath: '/src/b.ts', contentHash: 'hashB' };
    store.upsertFile(a);
    store.upsertFile(b);
    expect(store.getFile({ projectKey: 'proj', filePath: '/src/a.ts' })?.contentHash).toBe('hashA');
    expect(store.getFile({ projectKey: 'proj', filePath: '/src/b.ts' })?.contentHash).toBe('hashB');
  });
});

describe('createFileIndexStore – Negative / Error', () => {
  it('[NE-8] 존재 안 하는 키 getFile → null (throw 없음)', () => {
    expect(() => {
      const r = store.getFile({ projectKey: 'missing', filePath: '/none.ts' });
      expect(r).toBeNull();
    }).not.toThrow();
  });

  it('[NE-9] 없는 키 deleteFile → 에러 없음', () => {
    expect(() => {
      store.deleteFile({ projectKey: 'missing', filePath: '/none.ts' });
    }).not.toThrow();
  });

  it('[NE-10] deleteFile 후 getFile → null', () => {
    store.upsertFile(base);
    store.deleteFile({ projectKey: base.projectKey, filePath: base.filePath });
    expect(store.getFile({ projectKey: base.projectKey, filePath: base.filePath })).toBeNull();
  });
});

describe('createFileIndexStore – Edge', () => {
  it('[ED-11] 빈 문자열 projectKey + filePath → 저장/조회 가능', () => {
    const entry = { projectKey: '', filePath: '', mtimeMs: 0, size: 0, contentHash: '' };
    store.upsertFile(entry);
    const result = store.getFile({ projectKey: '', filePath: '' });
    expect(result).not.toBeNull();
  });

  it('[ED-12] mtimeMs=0, size=0 → 저장/조회 가능', () => {
    store.upsertFile({ ...base, mtimeMs: 0, size: 0 });
    const result = store.getFile({ projectKey: base.projectKey, filePath: base.filePath });
    expect(result?.mtimeMs).toBe(0);
    expect(result?.size).toBe(0);
  });

  it('[ED-13] contentHash 빈 문자열 → 저장/조회 가능', () => {
    store.upsertFile({ ...base, contentHash: '' });
    const result = store.getFile({ projectKey: base.projectKey, filePath: base.filePath });
    expect(result?.contentHash).toBe('');
  });
});

describe('createFileIndexStore – Corner', () => {
  it('[CO-14] 같은 filePath 다른 projectKey → 독립 엔트리', () => {
    store.upsertFile({ ...base, projectKey: 'projA', contentHash: 'A' });
    store.upsertFile({ ...base, projectKey: 'projB', contentHash: 'B' });
    expect(store.getFile({ projectKey: 'projA', filePath: base.filePath })?.contentHash).toBe('A');
    expect(store.getFile({ projectKey: 'projB', filePath: base.filePath })?.contentHash).toBe('B');
  });

  it('[CO-15] 동일 키 다른 값 여러 번 upsert → 마지막 값 유지', () => {
    for (let i = 1; i <= 5; i++) {
      store.upsertFile({ ...base, mtimeMs: i * 100 });
    }
    expect(store.getFile({ projectKey: base.projectKey, filePath: base.filePath })?.mtimeMs).toBe(500);
  });

  it('[CO-16] delete 후 같은 키 upsert → 새 엔트리', () => {
    store.upsertFile(base);
    store.deleteFile({ projectKey: base.projectKey, filePath: base.filePath });
    store.upsertFile({ ...base, mtimeMs: 7777 });
    expect(store.getFile({ projectKey: base.projectKey, filePath: base.filePath })?.mtimeMs).toBe(7777);
  });
});

describe('createFileIndexStore – State Transition', () => {
  it('[ST-17] store1 upsert → store2 cold cache getFile → sqlite 반환', () => {
    store.upsertFile(base);
    const store2 = createFileIndexStore(db);
    const result = store2.getFile({ projectKey: base.projectKey, filePath: base.filePath });
    expect(result?.contentHash).toBe(base.contentHash);
  });

  it('[ST-18] store1 delete → store2 getFile → null', () => {
    store.upsertFile(base);
    const store2 = createFileIndexStore(db);
    store.deleteFile({ projectKey: base.projectKey, filePath: base.filePath });
    expect(store2.getFile({ projectKey: base.projectKey, filePath: base.filePath })).toBeNull();
  });
});

describe('createFileIndexStore – Idempotency', () => {
  it('[ID-19] 동일 args upsertFile 2회 → getFile 동일 결과', () => {
    store.upsertFile(base);
    store.upsertFile(base);
    const result = store.getFile({ projectKey: base.projectKey, filePath: base.filePath });
    expect(result?.contentHash).toBe(base.contentHash);
  });

  it('[ID-20] deleteFile 2회 → 에러 없이 absent 유지', () => {
    store.upsertFile(base);
    store.deleteFile({ projectKey: base.projectKey, filePath: base.filePath });
    expect(() => store.deleteFile({ projectKey: base.projectKey, filePath: base.filePath })).not.toThrow();
    expect(store.getFile({ projectKey: base.projectKey, filePath: base.filePath })).toBeNull();
  });
});

describe('createFileIndexStore – Ordering', () => {
  it('[OR-21] upsert 전 getFile → null; 후 getFile → entry', () => {
    const key = { projectKey: base.projectKey, filePath: base.filePath };
    expect(store.getFile(key)).toBeNull();
    store.upsertFile(base);
    expect(store.getFile(key)).not.toBeNull();
  });
});
