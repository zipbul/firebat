import { describe, it, expect } from 'bun:test';
import { createInMemoryFileIndexRepository } from './file-index.repository';

describe('createInMemoryFileIndexRepository', () => {
  it('should return entry when getFile is called after upsertFile', async () => {
    // Arrange
    const repo = createInMemoryFileIndexRepository();

    // Act
    await repo.upsertFile({
      projectKey: 'proj',
      filePath: '/src/app.ts',
      mtimeMs: 1_700_000_000_000,
      size: 1024,
      contentHash: 'abc123',
    });
    const result = await repo.getFile({ projectKey: 'proj', filePath: '/src/app.ts' });

    // Assert
    expect(result).not.toBeNull();
    expect(result!.filePath).toBe('/src/app.ts');
    expect(result!.mtimeMs).toBe(1_700_000_000_000);
    expect(result!.size).toBe(1024);
    expect(result!.contentHash).toBe('abc123');
    expect(typeof result!.updatedAt).toBe('number');
  });

  it('should return null when getFile is called on a miss', async () => {
    // Arrange
    const repo = createInMemoryFileIndexRepository();

    // Act
    const result = await repo.getFile({ projectKey: 'proj', filePath: '/src/missing.ts' });

    // Assert
    expect(result).toBeNull();
  });

  it('should overwrite to latest value when upsertFile is called twice', async () => {
    // Arrange
    const repo = createInMemoryFileIndexRepository();
    await repo.upsertFile({ projectKey: 'proj', filePath: '/f.ts', mtimeMs: 1, size: 10, contentHash: 'old' });

    // Act
    await repo.upsertFile({ projectKey: 'proj', filePath: '/f.ts', mtimeMs: 2, size: 20, contentHash: 'new' });
    const result = await repo.getFile({ projectKey: 'proj', filePath: '/f.ts' });

    // Assert
    expect(result!.contentHash).toBe('new');
    expect(result!.mtimeMs).toBe(2);
    expect(result!.size).toBe(20);
  });

  it('should return null when getFile is called after deleteFile', async () => {
    // Arrange
    const repo = createInMemoryFileIndexRepository();
    await repo.upsertFile({ projectKey: 'proj', filePath: '/del.ts', mtimeMs: 1, size: 1, contentHash: 'h' });

    // Act
    await repo.deleteFile({ projectKey: 'proj', filePath: '/del.ts' });
    const result = await repo.getFile({ projectKey: 'proj', filePath: '/del.ts' });

    // Assert
    expect(result).toBeNull();
  });

  it('should isolate files across different projectKeys', async () => {
    // Arrange
    const repo = createInMemoryFileIndexRepository();
    await repo.upsertFile({ projectKey: 'proj-a', filePath: '/f.ts', mtimeMs: 1, size: 1, contentHash: 'ha' });

    // Act
    const result = await repo.getFile({ projectKey: 'proj-b', filePath: '/f.ts' });

    // Assert
    expect(result).toBeNull();
  });

  it('should store different filePaths independently', async () => {
    // Arrange
    const repo = createInMemoryFileIndexRepository();
    await repo.upsertFile({ projectKey: 'proj', filePath: '/a.ts', mtimeMs: 1, size: 1, contentHash: 'ha' });
    await repo.upsertFile({ projectKey: 'proj', filePath: '/b.ts', mtimeMs: 2, size: 2, contentHash: 'hb' });

    // Act
    const a = await repo.getFile({ projectKey: 'proj', filePath: '/a.ts' });
    const b = await repo.getFile({ projectKey: 'proj', filePath: '/b.ts' });

    // Assert
    expect(a!.contentHash).toBe('ha');
    expect(b!.contentHash).toBe('hb');
  });

  it('should support upsert→delete→upsert lifecycle', async () => {
    // Arrange
    const repo = createInMemoryFileIndexRepository();
    await repo.upsertFile({ projectKey: 'proj', filePath: '/f.ts', mtimeMs: 1, size: 1, contentHash: 'v1' });
    await repo.deleteFile({ projectKey: 'proj', filePath: '/f.ts' });

    // Act
    await repo.upsertFile({ projectKey: 'proj', filePath: '/f.ts', mtimeMs: 2, size: 2, contentHash: 'v2' });
    const result = await repo.getFile({ projectKey: 'proj', filePath: '/f.ts' });

    // Assert
    expect(result!.contentHash).toBe('v2');
  });

  it('should accept empty filePath and zero numeric values', async () => {
    // Arrange
    const repo = createInMemoryFileIndexRepository();

    // Act
    await repo.upsertFile({ projectKey: 'proj', filePath: '', mtimeMs: 0, size: 0, contentHash: '' });
    const result = await repo.getFile({ projectKey: 'proj', filePath: '' });

    // Assert
    expect(result!.filePath).toBe('');
    expect(result!.mtimeMs).toBe(0);
    expect(result!.size).toBe(0);
    expect(result!.contentHash).toBe('');
  });

  it('should complete without error when deleteFile is called on non-existent key', async () => {
    // Arrange
    const repo = createInMemoryFileIndexRepository();

    // Act & Assert
    await expect(
      repo.deleteFile({ projectKey: 'none', filePath: '/ghost.ts' })
    ).resolves.toBeUndefined();
  });
});
