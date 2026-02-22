import { describe, it, expect, spyOn, afterEach } from 'bun:test';
import { indexTargets } from './file-indexer';
import { createNoopLogger } from '../../ports/logger';

const logger = createNoopLogger('error');

const makeRepo = () => {
  const store = new Map<string, { filePath: string; mtimeMs: number; size: number; contentHash: string }>();

  return {
    getFile: async ({ filePath }: { projectKey: string; filePath: string }) => store.get(filePath) ?? null,
    upsertFile: async (entry: { projectKey: string; filePath: string; mtimeMs: number; size: number; contentHash: string }) => {
      store.set(entry.filePath, { filePath: entry.filePath, mtimeMs: entry.mtimeMs, size: entry.size, contentHash: entry.contentHash });
    },
    deleteFile: async ({ filePath }: { projectKey: string; filePath: string }) => {
      store.delete(filePath);
    },
    _store: store,
  };
};

let fileSpy: ReturnType<typeof spyOn>;

afterEach(() => {
  fileSpy?.mockRestore();
});

describe('indexTargets', () => {
  it('should do nothing when targets is empty', async () => {
    const repo = makeRepo();
    const upsertSpy = spyOn(repo, 'upsertFile');

    await indexTargets({ projectKey: 'p', targets: [], repository: repo as never, logger });

    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('should upsert file when not previously indexed', async () => {
    const repo = makeRepo();
    fileSpy = spyOn(Bun, 'file').mockReturnValue({
      stat: async () => ({ mtimeMs: 1000, size: 42 }),
      text: async () => 'const x = 1;',
    } as never);

    await indexTargets({ projectKey: 'p', targets: ['/a.ts'], repository: repo as never, logger });

    const entry = await repo.getFile({ projectKey: 'p', filePath: '/a.ts' });

    expect(entry).not.toBeNull();
    expect(entry?.mtimeMs).toBe(1000);
    expect(entry?.size).toBe(42);
  });

  it('should skip file when mtimeMs and size match existing entry', async () => {
    const repo = makeRepo();

    // Pre-populate repo
    await repo.upsertFile({ projectKey: 'p', filePath: '/a.ts', mtimeMs: 1000, size: 42, contentHash: 'abc' });

    fileSpy = spyOn(Bun, 'file').mockReturnValue({
      stat: async () => ({ mtimeMs: 1000, size: 42 }),
      text: async () => 'const x = 1;',
    } as never);

    const upsertSpy = spyOn(repo, 'upsertFile');

    await indexTargets({ projectKey: 'p', targets: ['/a.ts'], repository: repo as never, logger });

    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('should re-upsert when mtimeMs differs from existing entry', async () => {
    const repo = makeRepo();

    await repo.upsertFile({ projectKey: 'p', filePath: '/a.ts', mtimeMs: 999, size: 42, contentHash: 'old' });

    fileSpy = spyOn(Bun, 'file').mockReturnValue({
      stat: async () => ({ mtimeMs: 2000, size: 42 }),
      text: async () => 'updated content',
    } as never);

    await indexTargets({ projectKey: 'p', targets: ['/a.ts'], repository: repo as never, logger });

    const entry = await repo.getFile({ projectKey: 'p', filePath: '/a.ts' });

    expect(entry?.mtimeMs).toBe(2000);
  });

  it('should call deleteFile and increment failed when Bun.file throws', async () => {
    const repo = makeRepo();
    fileSpy = spyOn(Bun, 'file').mockReturnValue({
      stat: async () => { throw new Error('ENOENT'); },
      text: async () => '',
    } as never);

    const deleteSpy = spyOn(repo, 'deleteFile');

    await indexTargets({ projectKey: 'p', targets: ['/missing.ts'], repository: repo as never, logger });

    expect(deleteSpy).toHaveBeenCalledTimes(1);
  });

  it('should skip empty-path entries without calling Bun.file', async () => {
    const repo = makeRepo();
    const bunFileSpy = spyOn(Bun, 'file');

    await indexTargets({ projectKey: 'p', targets: ['   '], repository: repo as never, logger });

    expect(bunFileSpy).not.toHaveBeenCalled();
    bunFileSpy.mockRestore();
  });

  it('should index multiple files concurrently', async () => {
    const repo = makeRepo();
    fileSpy = spyOn(Bun, 'file').mockReturnValue({
      stat: async () => ({ mtimeMs: 100, size: 10 }),
      text: async () => 'code',
    } as never);

    await indexTargets({ projectKey: 'p', targets: ['/a.ts', '/b.ts', '/c.ts'], repository: repo as never, concurrency: 3, logger });

    expect(repo._store.size).toBe(3);
  });
});
