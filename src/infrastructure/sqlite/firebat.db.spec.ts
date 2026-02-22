import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { closeAll, getDb, getOrmDb } from './firebat.db';
import { createNoopLogger } from '../../ports/logger';

// These tests use a real temporary directory. Each test gets a unique dir.
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'firebat-db-test-'));
  // Reset module-level caches by calling closeAll
  await closeAll();
});

afterEach(async () => {
  await closeAll();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('infrastructure/sqlite/firebat.db — resolveDbPath', () => {
  it('getDb creates a SQLite Database instance at expected path', async () => {
    const logger = createNoopLogger();
    const db = await getDb({ rootAbs: tmpDir, logger });
    expect(db).toBeDefined();
    const dbPath = path.join(tmpDir, '.firebat', 'firebat.sqlite');
    const exists = await Bun.file(dbPath).exists();
    expect(exists).toBe(true);
  });

  it('getDb caches: calling twice returns same instance', async () => {
    const logger = createNoopLogger();
    const db1 = await getDb({ rootAbs: tmpDir, logger });
    const db2 = await getDb({ rootAbs: tmpDir, logger });
    expect(db1).toBe(db2);
  });

  it('getDb uses process.cwd() when rootAbs is omitted', async () => {
    const logger = createNoopLogger();
    const db = await getDb({ logger });
    expect(db).toBeDefined();
    expect(db.filename.length).toBeGreaterThan(0);
  });

  it('closeAll clears the cache so next getDb creates fresh connection', async () => {
    const logger = createNoopLogger();
    const db1 = await getDb({ rootAbs: tmpDir, logger });
    await closeAll();
    const tmpDir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'firebat-db-test-'));
    try {
      const db2 = await getDb({ rootAbs: tmpDir2, logger });
      expect(db1).not.toBe(db2);
      await closeAll();
    } finally {
      await fs.rm(tmpDir2, { recursive: true, force: true });
    }
  });
});

describe('infrastructure/sqlite/firebat.db — getOrmDb with migrations', () => {
  it('getOrmDb returns a Drizzle ORM instance after running migrations', async () => {
    const logger = createNoopLogger();
    const orm = await getOrmDb({ rootAbs: tmpDir, logger });
    expect(orm).toBeDefined();
    expect(typeof orm).toBe('object');
  });

  it('getOrmDb caches: second call returns same instance', async () => {
    const logger = createNoopLogger();
    const orm1 = await getOrmDb({ rootAbs: tmpDir, logger });
    const orm2 = await getOrmDb({ rootAbs: tmpDir, logger });
    expect(orm1).toBe(orm2);
  });

  it('after closeAll, getOrmDb creates a fresh ORM instance', async () => {
    const logger = createNoopLogger();
    const orm1 = await getOrmDb({ rootAbs: tmpDir, logger });
    await closeAll();
    const tmpDir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'firebat-db-test-'));
    try {
      const orm2 = await getOrmDb({ rootAbs: tmpDir2, logger });
      expect(orm1).not.toBe(orm2);
      await closeAll();
    } finally {
      await fs.rm(tmpDir2, { recursive: true, force: true });
    }
  });
});
