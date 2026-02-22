import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createDrizzleDb } from './drizzle-db';
import { createSqliteFileIndexRepository } from './file-index.repository';

let db: Database;
let repo: ReturnType<typeof createSqliteFileIndexRepository>;

beforeEach(() => {
  db = new Database(':memory:');
  db.run(`
    CREATE TABLE IF NOT EXISTS files (
      projectKey TEXT NOT NULL,
      filePath TEXT NOT NULL,
      mtimeMs INTEGER NOT NULL,
      size INTEGER NOT NULL,
      contentHash TEXT NOT NULL,
      updatedAt INTEGER NOT NULL,
      PRIMARY KEY (projectKey, filePath)
    )
  `);
  const orm = createDrizzleDb(db);
  repo = createSqliteFileIndexRepository(orm);
});

afterEach(() => {
  db.close();
});

const BASE_UPSERT = {
  projectKey: 'proj',
  filePath: '/src/app.ts',
  mtimeMs: 1_000,
  size: 512,
  contentHash: 'abc',
};

describe('createSqliteFileIndexRepository', () => {
  it('should return entry when getFile is called after upsertFile', async () => {
    // Arrange & Act
    await repo.upsertFile(BASE_UPSERT);
    const result = await repo.getFile({ projectKey: 'proj', filePath: '/src/app.ts' });

    // Assert
    expect(result).not.toBeNull();
    expect(result!.filePath).toBe('/src/app.ts');
    expect(result!.mtimeMs).toBe(1_000);
    expect(result!.size).toBe(512);
    expect(result!.contentHash).toBe('abc');
    expect(typeof result!.updatedAt).toBe('number');
  });

  it('should return null when getFile is called on a miss', async () => {
    // Act
    const result = await repo.getFile({ projectKey: 'proj', filePath: '/missing.ts' });

    // Assert
    expect(result).toBeNull();
  });

  it('should overwrite to latest value when upsertFile is called twice', async () => {
    // Arrange
    await repo.upsertFile(BASE_UPSERT);

    // Act
    await repo.upsertFile({ ...BASE_UPSERT, mtimeMs: 9_999, size: 999, contentHash: 'new' });
    const result = await repo.getFile({ projectKey: 'proj', filePath: '/src/app.ts' });

    // Assert
    expect(result!.contentHash).toBe('new');
    expect(result!.mtimeMs).toBe(9_999);
    expect(result!.size).toBe(999);
  });

  it('should return null when getFile is called after deleteFile', async () => {
    // Arrange
    await repo.upsertFile(BASE_UPSERT);

    // Act
    await repo.deleteFile({ projectKey: 'proj', filePath: '/src/app.ts' });
    const result = await repo.getFile({ projectKey: 'proj', filePath: '/src/app.ts' });

    // Assert
    expect(result).toBeNull();
  });

  it('should isolate files across different projectKeys', async () => {
    // Arrange
    await repo.upsertFile({ ...BASE_UPSERT, projectKey: 'proj-a' });

    // Act
    const result = await repo.getFile({ projectKey: 'proj-b', filePath: '/src/app.ts' });

    // Assert
    expect(result).toBeNull();
  });

  it('should accept empty filePath and zero numeric values', async () => {
    // Arrange & Act
    await repo.upsertFile({ ...BASE_UPSERT, filePath: '', mtimeMs: 0, size: 0, contentHash: '' });
    const result = await repo.getFile({ projectKey: 'proj', filePath: '' });

    // Assert
    expect(result!.filePath).toBe('');
    expect(result!.mtimeMs).toBe(0);
    expect(result!.size).toBe(0);
  });

  it('should support upsert→delete→upsert lifecycle', async () => {
    // Arrange
    await repo.upsertFile(BASE_UPSERT);
    await repo.deleteFile({ projectKey: 'proj', filePath: '/src/app.ts' });

    // Act
    await repo.upsertFile({ ...BASE_UPSERT, contentHash: 'v2' });
    const result = await repo.getFile({ projectKey: 'proj', filePath: '/src/app.ts' });

    // Assert
    expect(result!.contentHash).toBe('v2');
  });
});
