import { describe, it, expect } from 'bun:test';
import type {
  FileIndexEntry,
  GetFileInput,
  UpsertFileInput,
  DeleteFileInput,
  FileIndexRepository,
} from './file-index.repository';

describe('FileIndexEntry', () => {
  it('should have filePath/mtimeMs/size/contentHash/updatedAt shape when assigned', () => {
    const entry: FileIndexEntry = {
      filePath: '/project/src/main.ts',
      mtimeMs: 1700000000000,
      size: 1024,
      contentHash: 'abc123',
      updatedAt: 1700000000001,
    };

    expect(entry.filePath).toBe('/project/src/main.ts');
    expect(entry.mtimeMs).toBe(1700000000000);
    expect(entry.size).toBe(1024);
    expect(entry.contentHash).toBe('abc123');
    expect(entry.updatedAt).toBe(1700000000001);
  });

  it('should accept empty string filePath when assigned', () => {
    const entry: FileIndexEntry = {
      filePath: '',
      mtimeMs: 1700000000000,
      size: 512,
      contentHash: 'hash',
      updatedAt: 1700000000001,
    };

    expect(entry.filePath).toBe('');
  });

  it('should accept zero mtimeMs and size when assigned', () => {
    const entry: FileIndexEntry = {
      filePath: 'file.ts',
      mtimeMs: 0,
      size: 0,
      contentHash: 'hash',
      updatedAt: 0,
    };

    expect(entry.mtimeMs).toBe(0);
    expect(entry.size).toBe(0);
    expect(entry.updatedAt).toBe(0);
  });
});

describe('GetFileInput', () => {
  it('should satisfy projectKey and filePath shape when assigned', () => {
    const input: GetFileInput = {
      projectKey: 'my-project',
      filePath: '/src/app.ts',
    };

    expect(input.projectKey).toBe('my-project');
    expect(input.filePath).toBe('/src/app.ts');
  });
});

describe('UpsertFileInput', () => {
  it('should have 5-field shape when assigned', () => {
    const input: UpsertFileInput = {
      projectKey: 'proj',
      filePath: '/src/index.ts',
      mtimeMs: 1700000000000,
      size: 2048,
      contentHash: 'deadbeef',
    };

    expect(input.projectKey).toBe('proj');
    expect(input.filePath).toBe('/src/index.ts');
    expect(input.mtimeMs).toBe(1700000000000);
    expect(input.size).toBe(2048);
    expect(input.contentHash).toBe('deadbeef');
  });
});

describe('DeleteFileInput', () => {
  it('should satisfy projectKey and filePath shape when assigned', () => {
    const input: DeleteFileInput = {
      projectKey: 'proj',
      filePath: '/src/old.ts',
    };

    expect(input.projectKey).toBe('proj');
    expect(input.filePath).toBe('/src/old.ts');
  });
});

describe('FileIndexRepository', () => {
  it('should be implementable with getFile/upsertFile/deleteFile when mocked', () => {
    const repo: FileIndexRepository = {
      getFile: async () => null,
      upsertFile: async () => undefined,
      deleteFile: async () => undefined,
    };

    expect(typeof repo.getFile).toBe('function');
    expect(typeof repo.upsertFile).toBe('function');
    expect(typeof repo.deleteFile).toBe('function');
  });
});
