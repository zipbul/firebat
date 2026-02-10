import { Database } from 'bun:sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
// MUST: MUST-2
import { mkdir } from 'node:fs/promises';
import * as path from 'node:path';

import type { FirebatLogger } from '../../ports/logger';

import { createDrizzleDb, type FirebatDrizzleDb } from './drizzle-db';

const DB_RELATIVE_PATH = '.firebat/firebat.sqlite';

const resolveDbPath = (rootAbs: string): string => path.resolve(rootAbs, DB_RELATIVE_PATH);

const ensureDatabase = async (dbFilePath: string): Promise<Database> => {
  const dirPath = path.dirname(dbFilePath);

  await mkdir(dirPath, { recursive: true });

  const db = new Database(dbFilePath);

  db.run('PRAGMA journal_mode = WAL;');
  db.run('PRAGMA synchronous = NORMAL;');
  db.run('PRAGMA busy_timeout = 5000;');
  db.run('PRAGMA foreign_keys = ON;');

  return db;
};

const dbPromisesByPath = new Map<string, Promise<Database>>();
const ormPromisesByPath = new Map<string, Promise<FirebatDrizzleDb>>();

interface DbOpenInput {
  readonly rootAbs?: string;
  readonly logger: FirebatLogger;
}

const getDb = async (input: DbOpenInput): Promise<Database> => {
  const rootAbs = input.rootAbs ?? process.cwd();
  const dbFilePath = resolveDbPath(rootAbs);
  const existing = dbPromisesByPath.get(dbFilePath);

  if (existing) {
    input.logger.trace('sqlite: reusing cached DB connection', { dbFilePath });

    return existing;
  }

  input.logger.debug('sqlite: opening database', { dbFilePath });

  const created = ensureDatabase(dbFilePath);

  dbPromisesByPath.set(dbFilePath, created);

  return created;
};

const getOrmDb = async (input: DbOpenInput): Promise<FirebatDrizzleDb> => {
  const rootAbs = input.rootAbs ?? process.cwd();
  const dbFilePath = resolveDbPath(rootAbs);
  const existing = ormPromisesByPath.get(dbFilePath);

  if (existing) {
    input.logger.trace('sqlite: reusing cached ORM connection', { dbFilePath });

    return existing;
  }

  const created = (async (): Promise<FirebatDrizzleDb> => {
    const sqlite = await getDb({ rootAbs, logger: input.logger });
    const orm = createDrizzleDb(sqlite);
    const migrationsFolder = path.resolve(import.meta.dir, './migrations');

    const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

    const hasMemoriesTable = (): boolean => {
      try {
        const row = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memories'").get();

        return row !== null && row !== undefined;
      } catch {
        return false;
      }
    };

    // Concurrency-safe migrations:
    // - If tables are missing, try to migrate.
    // - If another process is migrating (busy/locked), wait for schema to appear.
    if (!hasMemoriesTable()) {
      input.logger.debug('sqlite: migrations needed', { migrationsFolder });

      try {
        migrate(orm, { migrationsFolder });
      } catch (err) {
        const msg = String(err).toLowerCase();

        if (msg.includes('busy') || msg.includes('locked')) {
          input.logger.warn('sqlite: migrations busy/locked; waiting for schema', { dbFilePath });
        } else {
          input.logger.warn('sqlite: migration failed', { error: String(err) });
        }
      }

      const deadlineMs = Date.now() + 15_000;
      let hasTable = hasMemoriesTable();

      while (!hasTable) {
        if (Date.now() > deadlineMs) {
          throw new Error('sqlite: migrations did not complete in time (memories table missing)');
        }

        await sleep(100);

        hasTable = hasMemoriesTable();
      }
    }

    input.logger.trace('sqlite: ORM ready');

    return orm;
  })();

  ormPromisesByPath.set(dbFilePath, created);

  return created;
};

const closeAll = async (): Promise<void> => {
  const dbInstances = await Promise.all(Array.from(dbPromisesByPath.values()));

  for (const db of dbInstances) {
    try {
      db.close();
    } catch {
      // Best-effort close
    }
  }

  dbPromisesByPath.clear();
  ormPromisesByPath.clear();
};

export { getDb, getOrmDb, closeAll };
