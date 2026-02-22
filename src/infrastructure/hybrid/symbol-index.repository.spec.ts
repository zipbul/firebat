import { describe, it, expect, spyOn } from 'bun:test';
import { createHybridSymbolIndexRepository } from './symbol-index.repository';
import { createInMemorySymbolIndexRepository } from '../memory/symbol-index.repository';

const makeSpan = () => ({
  start: { line: 1, column: 0 },
  end: { line: 1, column: 10 },
});

const BASE_REPLACE = {
  projectKey: 'proj',
  filePath: '/src/util.ts',
  contentHash: 'h',
  indexedAt: 100,
  symbols: [{ kind: 'function' as const, name: 'doWork', span: makeSpan() }],
};

describe('createHybridSymbolIndexRepository', () => {
  it('should return memory value and not call sqlite.getIndexedFile when memory hits', async () => {
    // Arrange
    const memory = createInMemorySymbolIndexRepository();
    const sqlite = createInMemorySymbolIndexRepository();
    await memory.replaceFileSymbols(BASE_REPLACE);
    const repo = createHybridSymbolIndexRepository({ memory, sqlite });
    const spyGet = spyOn(sqlite, 'getIndexedFile');

    // Act
    const result = await repo.getIndexedFile({ projectKey: 'proj', filePath: '/src/util.ts' });

    // Assert
    expect(result).not.toBeNull();
    expect(spyGet).not.toHaveBeenCalled();
  });

  it('should return sqlite value when memory misses on getIndexedFile', async () => {
    // Arrange
    const memory = createInMemorySymbolIndexRepository();
    const sqlite = createInMemorySymbolIndexRepository();
    await sqlite.replaceFileSymbols(BASE_REPLACE);
    const repo = createHybridSymbolIndexRepository({ memory, sqlite });

    // Act
    const result = await repo.getIndexedFile({ projectKey: 'proj', filePath: '/src/util.ts' });

    // Assert
    expect(result).not.toBeNull();
    expect(result!.contentHash).toBe('h');
  });

  it('should call sqlite.replaceFileSymbols before memory.replaceFileSymbols', async () => {
    // Arrange
    const memory = createInMemorySymbolIndexRepository();
    const sqlite = createInMemorySymbolIndexRepository();
    const repo = createHybridSymbolIndexRepository({ memory, sqlite });
    const calls: string[] = [];
    spyOn(sqlite, 'replaceFileSymbols').mockImplementation(async () => { calls.push('sqlite'); });
    spyOn(memory, 'replaceFileSymbols').mockImplementation(async () => { calls.push('memory'); });

    // Act
    await repo.replaceFileSymbols(BASE_REPLACE);

    // Assert
    expect(calls).toEqual(['sqlite', 'memory']);
  });

  it('should return memory search results and not call sqlite.search when memory has results', async () => {
    // Arrange
    const memory = createInMemorySymbolIndexRepository();
    const sqlite = createInMemorySymbolIndexRepository();
    await memory.replaceFileSymbols(BASE_REPLACE);
    const repo = createHybridSymbolIndexRepository({ memory, sqlite });
    const spySearch = spyOn(sqlite, 'search');

    // Act
    const results = await repo.search({ projectKey: 'proj', query: 'doWork' });

    // Assert
    expect(results.length).toBeGreaterThan(0);
    expect(spySearch).not.toHaveBeenCalled();
  });

  it('should return sqlite search results when memory search returns empty', async () => {
    // Arrange
    const memory = createInMemorySymbolIndexRepository();
    const sqlite = createInMemorySymbolIndexRepository();
    await sqlite.replaceFileSymbols(BASE_REPLACE);
    const repo = createHybridSymbolIndexRepository({ memory, sqlite });

    // Act
    const results = await repo.search({ projectKey: 'proj', query: 'doWork' });

    // Assert
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name).toBe('doWork');
  });

  it('should return memory stats and not call sqlite.getStats when memory has indexed files', async () => {
    // Arrange
    const memory = createInMemorySymbolIndexRepository();
    const sqlite = createInMemorySymbolIndexRepository();
    await memory.replaceFileSymbols(BASE_REPLACE);
    const repo = createHybridSymbolIndexRepository({ memory, sqlite });
    const spyStats = spyOn(sqlite, 'getStats');

    // Act
    await repo.getStats({ projectKey: 'proj' });

    // Assert
    expect(spyStats).not.toHaveBeenCalled();
  });

  it('should return sqlite stats when memory indexedFileCount is 0', async () => {
    // Arrange
    const memory = createInMemorySymbolIndexRepository();
    const sqlite = createInMemorySymbolIndexRepository();
    await sqlite.replaceFileSymbols(BASE_REPLACE);
    const repo = createHybridSymbolIndexRepository({ memory, sqlite });

    // Act
    const stats = await repo.getStats({ projectKey: 'proj' });

    // Assert
    expect(stats.indexedFileCount).toBe(1);
  });

  it('should call both sqlite.clearProject and memory.clearProject when clearProject is called', async () => {
    // Arrange
    const memory = createInMemorySymbolIndexRepository();
    const sqlite = createInMemorySymbolIndexRepository();
    const repo = createHybridSymbolIndexRepository({ memory, sqlite });
    const spyMem = spyOn(memory, 'clearProject');
    const spySql = spyOn(sqlite, 'clearProject');

    // Act
    await repo.clearProject({ projectKey: 'proj' });

    // Assert
    expect(spyMem).toHaveBeenCalledTimes(1);
    expect(spySql).toHaveBeenCalledTimes(1);
  });
});
