import { mock, describe, it, expect, afterAll } from 'bun:test';
import * as path from 'node:path';

const __origFirebatDb = { ...require(path.resolve(import.meta.dir, '../../infrastructure/sqlite/firebat.db.ts')) };
const __origFileIndexStore = { ...require(path.resolve(import.meta.dir, '../../store/file-index.ts')) };
const __origMemSymIndex = { ...require(path.resolve(import.meta.dir, '../../infrastructure/memory/symbol-index.repository.ts')) };
const __origSqliteSymIndex = { ...require(path.resolve(import.meta.dir, '../../infrastructure/sqlite/symbol-index.repository.ts')) };
const __origHybridSymIndex = { ...require(path.resolve(import.meta.dir, '../../infrastructure/hybrid/symbol-index.repository.ts')) };
const __origRuntimeContext = { ...require(path.resolve(import.meta.dir, '../../runtime-context.ts')) };
const __origTargetDiscovery = { ...require(path.resolve(import.meta.dir, '../../target-discovery.ts')) };
const __origToolVersion = { ...require(path.resolve(import.meta.dir, '../../tool-version.ts')) };
const __origFileIndexer = { ...require(path.resolve(import.meta.dir, '../indexing/file-indexer.ts')) };

// Mock all heavy infrastructure before importing the usecase
const mockDb = {};
const mockOrm = {};
const mockSymIndexMemRepo = {
  getIndexedFile: async () => null,
  replaceFileSymbols: async () => {},
  search: async () => [],
  getStats: async () => ({ fileCount: 0, symbolCount: 0, lastIndexedAt: null }),
  clearProject: async () => {},
};
const mockSymIndexSqliteRepo = {
  getIndexedFile: async () => null,
  replaceFileSymbols: async () => {},
  search: async () => [],
  getStats: async () => ({ fileCount: 0, symbolCount: 0, lastIndexedAt: null }),
  clearProject: async () => {},
};
const mockFileIndexHybridRepo = {
  getFile: () => null,
  upsertFile: () => {},
  deleteFile: () => {},
};
const mockSymIndexHybridRepo = {
  getIndexedFile: async () => null,
  replaceFileSymbols: async () => {},
  search: async (_: unknown) => [] as unknown[],
  getStats: async (_: unknown) => ({ fileCount: 0, symbolCount: 0, lastIndexedAt: null }),
  clearProject: async () => {},
};

mock.module(path.resolve(import.meta.dir, '../../infrastructure/sqlite/firebat.db.ts'), () => ({
  getDb: async () => mockDb,
  getOrmDb: async () => mockOrm,
}));
mock.module(path.resolve(import.meta.dir, '../../store/file-index.ts'), () => ({
  createFileIndexStore: () => mockFileIndexHybridRepo,
}));
mock.module(path.resolve(import.meta.dir, '../../infrastructure/memory/symbol-index.repository.ts'), () => ({
  createInMemorySymbolIndexRepository: () => mockSymIndexMemRepo,
}));
mock.module(path.resolve(import.meta.dir, '../../infrastructure/sqlite/symbol-index.repository.ts'), () => ({
  createSqliteSymbolIndexRepository: () => mockSymIndexSqliteRepo,
}));
mock.module(path.resolve(import.meta.dir, '../../infrastructure/hybrid/symbol-index.repository.ts'), () => ({
  createHybridSymbolIndexRepository: () => mockSymIndexHybridRepo,
}));
mock.module(path.resolve(import.meta.dir, '../../runtime-context.ts'), () => ({
  resolveRuntimeContextFromCwd: async () => ({ rootAbs: '/project' }),
}));
mock.module(path.resolve(import.meta.dir, '../../target-discovery.ts'), () => ({
  resolveTargets: async (_cwd: string, targets?: ReadonlyArray<string>) => targets ?? [],
}));
mock.module(path.resolve(import.meta.dir, '../../tool-version.ts'), () => ({
  computeToolVersion: () => '1.0.0-test',
}));
mock.module(path.resolve(import.meta.dir, '../indexing/file-indexer.ts'), () => ({
  indexTargets: async () => {},
}));

import {
  indexSymbolsUseCase,
  searchSymbolFromIndexUseCase,
  getIndexStatsFromIndexUseCase,
  clearIndexUseCase,
} from './symbol-index.usecases';
import { createNoopLogger } from '../../ports/logger';

const logger = createNoopLogger('error');

describe('indexSymbolsUseCase', () => {
  it('should return ok:true with zero counts when targets is empty', async () => {
    const result = await indexSymbolsUseCase({ targets: [], logger });

    expect(result.ok).toBe(true);
    expect(result.indexedFiles).toBe(0);
    expect(result.skippedFiles).toBe(0);
    expect(result.symbolsIndexed).toBe(0);
    expect(result.parseErrors).toBe(0);
  });

  it('should return ok:true when no targets provided', async () => {
    const result = await indexSymbolsUseCase({ logger });

    expect(result.ok).toBe(true);
  });
});

describe('searchSymbolFromIndexUseCase', () => {
  it('should return empty array when index is empty', async () => {
    const result = await searchSymbolFromIndexUseCase({ query: 'foo', logger });

    expect(result).toEqual([]);
  });

  it('should accept limit option without throwing', async () => {
    const result = await searchSymbolFromIndexUseCase({ query: 'bar', limit: 5, logger });

    expect(Array.isArray(result)).toBe(true);
  });
});

describe('getIndexStatsFromIndexUseCase', () => {
  it('should return zero stats when empty', async () => {
    const stats = await getIndexStatsFromIndexUseCase({ logger });

    expect(stats.indexedFileCount).toBe(0);
    expect(stats.symbolCount).toBe(0);
    expect(stats.lastIndexedAt).toBeNull();
  });
});

describe('clearIndexUseCase', () => {
  it('should complete without throwing', async () => {
    await expect(clearIndexUseCase({ logger })).resolves.toBeUndefined();
  });
});

afterAll(() => {
  mock.restore();
  mock.module(path.resolve(import.meta.dir, '../../infrastructure/sqlite/firebat.db.ts'), () => __origFirebatDb);
  mock.module(path.resolve(import.meta.dir, '../../store/file-index.ts'), () => __origFileIndexStore);
  mock.module(path.resolve(import.meta.dir, '../../infrastructure/memory/symbol-index.repository.ts'), () => __origMemSymIndex);
  mock.module(path.resolve(import.meta.dir, '../../infrastructure/sqlite/symbol-index.repository.ts'), () => __origSqliteSymIndex);
  mock.module(path.resolve(import.meta.dir, '../../infrastructure/hybrid/symbol-index.repository.ts'), () => __origHybridSymIndex);
  mock.module(path.resolve(import.meta.dir, '../../runtime-context.ts'), () => __origRuntimeContext);
  mock.module(path.resolve(import.meta.dir, '../../target-discovery.ts'), () => __origTargetDiscovery);
  mock.module(path.resolve(import.meta.dir, '../../tool-version.ts'), () => __origToolVersion);
  mock.module(path.resolve(import.meta.dir, '../indexing/file-indexer.ts'), () => __origFileIndexer);
});

