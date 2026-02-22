import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';

import { createDrizzleDb, type FirebatDrizzleDb } from './drizzle-db';

describe('infrastructure/sqlite/drizzle-db', () => {
  it('createDrizzleDb returns a non-null ORM instance', () => {
    const db = new Database(':memory:');
    const orm = createDrizzleDb(db);
    expect(orm).toBeDefined();
    expect(orm).not.toBeNull();
    db.close();
  });

  it('FirebatDrizzleDb type is the return type of createDrizzleDb', () => {
    const db = new Database(':memory:');
    const orm: FirebatDrizzleDb = createDrizzleDb(db);
    expect(typeof orm).toBe('object');
    db.close();
  });

  it('two calls with different Database instances produce independent ORM objects', () => {
    const db1 = new Database(':memory:');
    const db2 = new Database(':memory:');
    const orm1 = createDrizzleDb(db1);
    const orm2 = createDrizzleDb(db2);
    expect(orm1).not.toBe(orm2);
    db1.close();
    db2.close();
  });
});
