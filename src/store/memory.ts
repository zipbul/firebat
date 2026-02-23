import { Database } from 'bun:sqlite';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryRecord {
  readonly projectKey: string;
  readonly memoryKey: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly payloadJson: string;
}

export interface MemoryKeyEntry {
  readonly memoryKey: string;
  readonly updatedAt: number;
}

export interface MemoryStore {
  listKeys(input: { readonly projectKey: string }): ReadonlyArray<MemoryKeyEntry>;
  read(input: { readonly projectKey: string; readonly memoryKey: string }): MemoryRecord | null;
  write(input: { readonly projectKey: string; readonly memoryKey: string; readonly payloadJson: string }): void;
  delete(input: { readonly projectKey: string; readonly memoryKey: string }): void;
}

// ---------------------------------------------------------------------------
// Schema DDL
// ---------------------------------------------------------------------------

const ENSURE_TABLE = `
CREATE TABLE IF NOT EXISTS memories (
  projectKey  TEXT    NOT NULL,
  memoryKey   TEXT    NOT NULL,
  createdAt   INTEGER NOT NULL,
  updatedAt   INTEGER NOT NULL,
  payloadJson TEXT    NOT NULL,
  PRIMARY KEY (projectKey, memoryKey)
);
`;

const ENSURE_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_memories_projectKey ON memories(projectKey);',
  'CREATE INDEX IF NOT EXISTS idx_memories_updatedAt ON memories(updatedAt);',
];

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export const createMemoryStore = (db: Database): MemoryStore => {
  // Ensure schema
  db.run(ENSURE_TABLE);

  for (const ddl of ENSURE_INDEXES) {
    db.run(ddl);
  }

  // Prepared statements
  const listKeysStmt = db.prepare<{ memoryKey: string; updatedAt: number }, [string]>(
    'SELECT memoryKey, updatedAt FROM memories WHERE projectKey = ? ORDER BY updatedAt DESC',
  );

  const readStmt = db.prepare<
    { projectKey: string; memoryKey: string; createdAt: number; updatedAt: number; payloadJson: string },
    [string, string]
  >('SELECT projectKey, memoryKey, createdAt, updatedAt, payloadJson FROM memories WHERE projectKey = ? AND memoryKey = ?');

  const existsStmt = db.prepare<{ createdAt: number }, [string, string]>(
    'SELECT createdAt FROM memories WHERE projectKey = ? AND memoryKey = ?',
  );

  const upsertStmt = db.prepare<void, [string, string, number, number, string]>(
    `INSERT INTO memories (projectKey, memoryKey, createdAt, updatedAt, payloadJson)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (projectKey, memoryKey)
     DO UPDATE SET updatedAt = excluded.updatedAt, payloadJson = excluded.payloadJson`,
  );

  const deleteStmt = db.prepare<void, [string, string]>('DELETE FROM memories WHERE projectKey = ? AND memoryKey = ?');

  return {
    listKeys({ projectKey }): ReadonlyArray<MemoryKeyEntry> {
      return listKeysStmt.all(projectKey);
    },

    read({ projectKey, memoryKey }): MemoryRecord | null {
      return readStmt.get(projectKey, memoryKey) ?? null;
    },

    write({ projectKey, memoryKey, payloadJson }): void {
      const now = Date.now();
      const existing = existsStmt.get(projectKey, memoryKey);
      const createdAt = existing?.createdAt ?? now;

      upsertStmt.run(projectKey, memoryKey, createdAt, now, payloadJson);
    },

    delete({ projectKey, memoryKey }): void {
      deleteStmt.run(projectKey, memoryKey);
    },
  };
};
