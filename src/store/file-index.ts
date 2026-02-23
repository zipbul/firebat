import type { Database } from 'bun:sqlite';

interface FileIndexEntry {
  readonly filePath: string;
  readonly mtimeMs: number;
  readonly size: number;
  readonly contentHash: string;
  readonly updatedAt: number;
}

interface GetFileInput {
  readonly projectKey: string;
  readonly filePath: string;
}

interface UpsertFileInput {
  readonly projectKey: string;
  readonly filePath: string;
  readonly mtimeMs: number;
  readonly size: number;
  readonly contentHash: string;
}

interface DeleteFileInput {
  readonly projectKey: string;
  readonly filePath: string;
}

interface FileIndexStore {
  getFile(input: GetFileInput): FileIndexEntry | null;
  upsertFile(input: UpsertFileInput): void;
  deleteFile(input: DeleteFileInput): void;
}

const cacheKey = (projectKey: string, filePath: string): string =>
  `${projectKey}\0${filePath}`;

const createFileIndexStore = (db: Database): FileIndexStore => {
  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      projectKey TEXT NOT NULL,
      filePath   TEXT NOT NULL,
      mtimeMs    INTEGER NOT NULL,
      size       INTEGER NOT NULL,
      contentHash TEXT NOT NULL,
      updatedAt  INTEGER NOT NULL,
      PRIMARY KEY (projectKey, filePath)
    )
  `);

  db.run(
    `CREATE INDEX IF NOT EXISTS idx_files_projectKey ON files (projectKey)`,
  );

  const getStmt = db.prepare<
    { filePath: string; mtimeMs: number; size: number; contentHash: string; updatedAt: number },
    [string, string]
  >(
    'SELECT filePath, mtimeMs, size, contentHash, updatedAt FROM files WHERE projectKey = ? AND filePath = ?',
  );

  const upsertStmt = db.prepare<void, [string, string, number, number, string, number]>(
    'INSERT OR REPLACE INTO files (projectKey, filePath, mtimeMs, size, contentHash, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
  );

  const deleteStmt = db.prepare<void, [string, string]>(
    'DELETE FROM files WHERE projectKey = ? AND filePath = ?',
  );

  const cache = new Map<string, FileIndexEntry>();

  return {
    getFile({ projectKey, filePath }: GetFileInput): FileIndexEntry | null {
      const key = cacheKey(projectKey, filePath);
      const cached = cache.get(key);

      if (cached) {
        return cached;
      }

      const row = getStmt.get(projectKey, filePath);

      if (row) {
        cache.set(key, row);
      }

      return row ?? null;
    },

    upsertFile({ projectKey, filePath, mtimeMs, size, contentHash }: UpsertFileInput): void {
      const updatedAt = Date.now();
      upsertStmt.run(projectKey, filePath, mtimeMs, size, contentHash, updatedAt);
      cache.set(cacheKey(projectKey, filePath), { filePath, mtimeMs, size, contentHash, updatedAt });
    },

    deleteFile({ projectKey, filePath }: DeleteFileInput): void {
      deleteStmt.run(projectKey, filePath);
      cache.delete(cacheKey(projectKey, filePath));
    },
  };
};

export type { DeleteFileInput, FileIndexEntry, FileIndexStore, GetFileInput, UpsertFileInput };
export { createFileIndexStore };
