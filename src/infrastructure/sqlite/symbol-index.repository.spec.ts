import { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createDrizzleDb } from './drizzle-db';
import { createSqliteSymbolIndexRepository } from './symbol-index.repository';

let db: Database;
let repo: ReturnType<typeof createSqliteSymbolIndexRepository>;

beforeEach(() => {
  db = new Database(':memory:');
  db.run(`
    CREATE TABLE IF NOT EXISTS symbol_files (
      projectKey TEXT NOT NULL,
      filePath TEXT NOT NULL,
      contentHash TEXT NOT NULL,
      indexedAt INTEGER NOT NULL,
      symbolCount INTEGER NOT NULL,
      PRIMARY KEY (projectKey, filePath)
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      projectKey TEXT NOT NULL,
      filePath TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      startLine INTEGER NOT NULL,
      startColumn INTEGER NOT NULL,
      endLine INTEGER NOT NULL,
      endColumn INTEGER NOT NULL,
      isExported INTEGER NOT NULL DEFAULT 0,
      indexedAt INTEGER NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_symbols_proj_name ON symbols (projectKey, name)`);
  const orm = createDrizzleDb(db);
  repo = createSqliteSymbolIndexRepository(orm);
});

afterEach(() => {
  db.close();
});

const makeSpan = (startLine = 1) => ({
  start: { line: startLine, column: 0 },
  end: { line: startLine, column: 20 },
});

const BASE_REPLACE = {
  projectKey: 'proj',
  filePath: '/src/util.ts',
  contentHash: 'h1',
  indexedAt: 1000,
  symbols: [{ kind: 'function' as const, name: 'doWork', span: makeSpan() }],
};

describe('createSqliteSymbolIndexRepository', () => {
  it('should return meta when getIndexedFile is called after replaceFileSymbols', async () => {
    // Arrange & Act
    await repo.replaceFileSymbols(BASE_REPLACE);
    const result = await repo.getIndexedFile({ projectKey: 'proj', filePath: '/src/util.ts' });

    // Assert
    expect(result).not.toBeNull();
    expect(result!.contentHash).toBe('h1');
    expect(result!.indexedAt).toBe(1000);
    expect(result!.symbolCount).toBe(1);
  });

  it('should return null when getIndexedFile is called on a missing file', async () => {
    // Act
    const result = await repo.getIndexedFile({ projectKey: 'proj', filePath: '/missing.ts' });

    // Assert
    expect(result).toBeNull();
  });

  it('should return matching symbol when search is called with partial name', async () => {
    // Arrange
    await repo.replaceFileSymbols(BASE_REPLACE);

    // Act
    const results = await repo.search({ projectKey: 'proj', query: 'work' });

    // Assert
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe('doWork');
    expect(results[0]!.filePath).toBe('/src/util.ts');
  });

  it('should return empty array when search is called with empty query', async () => {
    // Arrange
    await repo.replaceFileSymbols(BASE_REPLACE);

    // Act
    const results = await repo.search({ projectKey: 'proj', query: '' });

    // Assert
    expect(results).toHaveLength(0);
  });

  it('should store symbolCount as 0 when replaceFileSymbols is called with empty symbols', async () => {
    // Arrange & Act
    await repo.replaceFileSymbols({ ...BASE_REPLACE, symbols: [] });
    const result = await repo.getIndexedFile({ projectKey: 'proj', filePath: '/src/util.ts' });

    // Assert
    expect(result!.symbolCount).toBe(0);
  });

  it('should return accurate fileCount/symbolCount/lastIndexedAt from getStats', async () => {
    // Arrange
    await repo.replaceFileSymbols({
      projectKey: 'proj', filePath: '/a.ts', contentHash: 'h1', indexedAt: 500,
      symbols: [{ kind: 'function', name: 'f1', span: makeSpan() }, { kind: 'class', name: 'C1', span: makeSpan(2) }],
    });
    await repo.replaceFileSymbols({
      projectKey: 'proj', filePath: '/b.ts', contentHash: 'h2', indexedAt: 800,
      symbols: [{ kind: 'method', name: 'm1', span: makeSpan() }],
    });

    // Act
    const stats = await repo.getStats({ projectKey: 'proj' });

    // Assert
    expect(stats.indexedFileCount).toBe(2);
    expect(stats.symbolCount).toBe(3);
    expect(stats.lastIndexedAt).toBe(800);
  });

  it('should return 0/0/null from getStats when project has no files', async () => {
    // Act
    const stats = await repo.getStats({ projectKey: 'empty-project' });

    // Assert
    expect(stats.indexedFileCount).toBe(0);
    expect(stats.symbolCount).toBe(0);
    expect(stats.lastIndexedAt).toBeNull();
  });

  it('should reset stats after clearProject is called', async () => {
    // Arrange
    await repo.replaceFileSymbols(BASE_REPLACE);

    // Act
    await repo.clearProject({ projectKey: 'proj' });
    const stats = await repo.getStats({ projectKey: 'proj' });

    // Assert
    expect(stats.indexedFileCount).toBe(0);
    expect(stats.symbolCount).toBe(0);
  });

  it('should match symbols case-insensitively when search is called', async () => {
    // Arrange
    await repo.replaceFileSymbols({
      ...BASE_REPLACE,
      symbols: [{ kind: 'class', name: 'MyWidget', span: makeSpan() }],
    });

    // Act
    const results = await repo.search({ projectKey: 'proj', query: 'WIDGET' });

    // Assert
    expect(results.length).toBe(1);
    expect(results[0]!.name).toBe('MyWidget');
  });

  it('should isolate data across different projectKeys', async () => {
    // Arrange
    await repo.replaceFileSymbols({ ...BASE_REPLACE, projectKey: 'proj-a' });

    // Act
    const stats = await repo.getStats({ projectKey: 'proj-b' });
    const result = await repo.getIndexedFile({ projectKey: 'proj-b', filePath: '/src/util.ts' });

    // Assert
    expect(stats.indexedFileCount).toBe(0);
    expect(result).toBeNull();
  });

  it('should overwrite symbols when replaceFileSymbols is called twice for same file', async () => {
    // Arrange
    await repo.replaceFileSymbols(BASE_REPLACE);

    // Act
    await repo.replaceFileSymbols({
      ...BASE_REPLACE,
      symbols: [
        { kind: 'function', name: 'newFn1', span: makeSpan() },
        { kind: 'function', name: 'newFn2', span: makeSpan(2) },
      ],
    });
    const results = await repo.search({ projectKey: 'proj', query: 'new' });
    const old = await repo.search({ projectKey: 'proj', query: 'doWork' });

    // Assert
    expect(results.length).toBe(2);
    expect(old.length).toBe(0);
  });
});
