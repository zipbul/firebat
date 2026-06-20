import { Database } from 'bun:sqlite';

/**
 * Runs a store's schema-init protocol: create the table, then create each
 * index. Shared by the SQLite-backed stores so the boot protocol (order,
 * future PRAGMA/transaction wrapping) has a single change point; each store
 * still owns its own table/index DDL data.
 */
export const ensureSchema = (db: Database, table: string, indexes: ReadonlyArray<string>): void => {
  db.run(table);

  for (const ddl of indexes) {
    db.run(ddl);
  }
};
