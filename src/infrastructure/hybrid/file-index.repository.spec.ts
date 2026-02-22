import { describe, it, expect, spyOn } from 'bun:test';
import { createHybridFileIndexRepository } from './file-index.repository';
import { createInMemoryFileIndexRepository } from '../memory/file-index.repository';

const BASE_UPSERT = {
  projectKey: 'proj',
  filePath: '/src/app.ts',
  mtimeMs: 1_000,
  size: 512,
  contentHash: 'abc',
};

describe('createHybridFileIndexRepository', () => {
  it('should return memory value and not call sqlite.getFile when memory hits', async () => {
    // Arrange
    const memory = createInMemoryFileIndexRepository();
    const sqlite = createInMemoryFileIndexRepository();
    await memory.upsertFile(BASE_UPSERT);
    const repo = createHybridFileIndexRepository({ memory, sqlite });
    const spyGet = spyOn(sqlite, 'getFile');

    // Act
    const result = await repo.getFile({ projectKey: 'proj', filePath: '/src/app.ts' });

    // Assert
    expect(result).not.toBeNull();
    expect(result!.contentHash).toBe('abc');
    expect(spyGet).not.toHaveBeenCalled();
  });

  it('should return sqlite value and cache to memory when memory misses and sqlite hits', async () => {
    // Arrange
    const memory = createInMemoryFileIndexRepository();
    const sqlite = createInMemoryFileIndexRepository();
    await sqlite.upsertFile(BASE_UPSERT);
    const repo = createHybridFileIndexRepository({ memory, sqlite });
    const spyUpsert = spyOn(memory, 'upsertFile');

    // Act
    const result = await repo.getFile({ projectKey: 'proj', filePath: '/src/app.ts' });

    // Assert
    expect(result!.contentHash).toBe('abc');
    expect(spyUpsert).toHaveBeenCalledTimes(1);
  });

  it('should return null when both memory and sqlite miss', async () => {
    // Arrange
    const memory = createInMemoryFileIndexRepository();
    const sqlite = createInMemoryFileIndexRepository();
    const repo = createHybridFileIndexRepository({ memory, sqlite });

    // Act
    const result = await repo.getFile({ projectKey: 'proj', filePath: '/missing.ts' });

    // Assert
    expect(result).toBeNull();
  });

  it('should call both memory.upsertFile and sqlite.upsertFile when upsertFile is called', async () => {
    // Arrange
    const memory = createInMemoryFileIndexRepository();
    const sqlite = createInMemoryFileIndexRepository();
    const repo = createHybridFileIndexRepository({ memory, sqlite });
    const spyMem = spyOn(memory, 'upsertFile');
    const spySql = spyOn(sqlite, 'upsertFile');

    // Act
    await repo.upsertFile(BASE_UPSERT);

    // Assert
    expect(spyMem).toHaveBeenCalledTimes(1);
    expect(spySql).toHaveBeenCalledTimes(1);
  });

  it('should call both memory.deleteFile and sqlite.deleteFile when deleteFile is called', async () => {
    // Arrange
    const memory = createInMemoryFileIndexRepository();
    const sqlite = createInMemoryFileIndexRepository();
    const repo = createHybridFileIndexRepository({ memory, sqlite });
    const spyMem = spyOn(memory, 'deleteFile');
    const spySql = spyOn(sqlite, 'deleteFile');

    // Act
    await repo.deleteFile({ projectKey: 'proj', filePath: '/src/app.ts' });

    // Assert
    expect(spyMem).toHaveBeenCalledTimes(1);
    expect(spySql).toHaveBeenCalledTimes(1);
  });

  it('should return memory-cached value on second getFile call after sqlite populates cache', async () => {
    // Arrange
    const memory = createInMemoryFileIndexRepository();
    const sqlite = createInMemoryFileIndexRepository();
    await sqlite.upsertFile(BASE_UPSERT);
    const repo = createHybridFileIndexRepository({ memory, sqlite });
    await repo.getFile({ projectKey: 'proj', filePath: '/src/app.ts' }); // cache fill

    const spySqlGet = spyOn(sqlite, 'getFile');

    // Act
    const result = await repo.getFile({ projectKey: 'proj', filePath: '/src/app.ts' });

    // Assert
    expect(result!.contentHash).toBe('abc');
    expect(spySqlGet).not.toHaveBeenCalled();
  });
});
