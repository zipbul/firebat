// MUST: MUST-2
import { mkdir } from 'node:fs/promises';
import * as path from 'node:path';

import { Database } from 'bun:sqlite';

import { createDrizzleDb, type FirebatDrizzleDb } from './drizzle-db';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';

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
}

const getDb = async (input?: DbOpenInput): Promise<Database> => {
  const rootAbs = input?.rootAbs ?? process.cwd();
  const dbFilePath = resolveDbPath(rootAbs);
  const existing = dbPromisesByPath.get(dbFilePath);

  if (existing) {
    return existing;
  }

  const created = ensureDatabase(dbFilePath);

  dbPromisesByPath.set(dbFilePath, created);

  return created;
};

const getOrmDb = async (input?: DbOpenInput): Promise<FirebatDrizzleDb> => {
  const rootAbs = input?.rootAbs ?? process.cwd();
  const dbFilePath = resolveDbPath(rootAbs);
  const existing = ormPromisesByPath.get(dbFilePath);

  if (existing) {
    return existing;
  }

  const created = (async (): Promise<FirebatDrizzleDb> => {
    const sqlite = await getDb({ rootAbs });
    const orm = createDrizzleDb(sqlite);
    const migrationsFolder = path.resolve(import.meta.dir, './migrations');

    migrate(orm, { migrationsFolder });

    return orm;
  })();

  ormPromisesByPath.set(dbFilePath, created);

  return created;
};

export { getDb, getOrmDb };
