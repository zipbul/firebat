import { mock, describe, it, expect, afterAll } from 'bun:test';
import * as nodePath from 'node:path';

import { emptyBatchParse } from '../../../test/integration/shared/test-kit';

const __origFirebatDb = { ...require(nodePath.resolve(import.meta.dir, '../../infrastructure/sqlite/firebat.db.ts')) };
const __origArtifactStore = { ...require(nodePath.resolve(import.meta.dir, '../../store/artifact.ts')) };
const __origGildashStore = { ...require(nodePath.resolve(import.meta.dir, '../../store/gildash.ts')) };
const __origRuntimeContext = { ...require(nodePath.resolve(import.meta.dir, '../../shared/runtime-context.ts')) };
const __origToolVersion = { ...require(nodePath.resolve(import.meta.dir, '../../shared/tool-version.ts')) };

// Mock all heavy infrastructure
void mock.module(nodePath.resolve(import.meta.dir, '../../infrastructure/sqlite/firebat.db.ts'), () => ({
  getDb: async () => ({}),
  getOrmDb: async () => ({}),
}));
void mock.module(nodePath.resolve(import.meta.dir, '../../store/artifact.ts'), () => ({
  createArtifactStore: () => ({
    get: () => null,
    set: () => {},
  }),
}));
void mock.module(nodePath.resolve(import.meta.dir, '../../store/gildash.ts'), () => ({
  createGildash: async () => ({
    getFileInfo: () => null,
    getSemanticReferences: () => [],
    getHeritageChain: async () => ({ name: 'MyClass', bases: [] }),
    close: async () => {},
    batchParse: emptyBatchParse,
    searchSymbols: () => [],
    searchRelations: () => [],
    getAffected: async () => [],
    getImportGraph: async () => new Map(),
  }),
  __testing__: __origGildashStore.__testing__,
}));
void mock.module(nodePath.resolve(import.meta.dir, '../../shared/runtime-context.ts'), () => ({
  resolveRuntimeContextFromCwd: async () => ({ rootAbs: '/project' }),
}));
void mock.module(nodePath.resolve(import.meta.dir, '../../shared/tool-version.ts'), () => ({
  computeToolVersion: () => '1.0.0-test',
}));

import { createNoopLogger } from '../../shared/logger';
import { traceSymbolUseCase } from './trace-symbol.usecase';

const logger = createNoopLogger('error');

interface GraphShapeRow {
  readonly name: string;
  readonly entryFile: string;
  readonly symbol: string;
}

const graphShapeRows: GraphShapeRow[] = [
  { name: 'graph from gildash', entryFile: '/project/src/index.ts', symbol: 'MyClass' },
  { name: 'graph and evidence structure', entryFile: '/project/src/lib.ts', symbol: 'helperFn' },
];

describe('traceSymbolUseCase', () => {
  it('should return ok:true with graph from gildash', async () => {
    const result = await traceSymbolUseCase({
      entryFile: '/project/src/index.ts',
      symbol: 'MyClass',
      logger,
    });

    expect(result.ok).toBe(true);
    expect(result.tool).toBe('gildash');
    expect(result.graph).toBeDefined();
  });

  it.each(graphShapeRows)('should return ok:true with $name', async ({ entryFile, symbol }) => {
    const result = await traceSymbolUseCase({ entryFile, symbol, logger });

    expect(Array.isArray(result.graph.nodes)).toBe(true);
    expect(Array.isArray(result.graph.edges)).toBe(true);
    expect(Array.isArray(result.evidence)).toBe(true);
  });
});

afterAll(() => {
  mock.restore();
  void mock.module(nodePath.resolve(import.meta.dir, '../../infrastructure/sqlite/firebat.db.ts'), () => __origFirebatDb);
  void mock.module(nodePath.resolve(import.meta.dir, '../../store/artifact.ts'), () => __origArtifactStore);
  void mock.module(nodePath.resolve(import.meta.dir, '../../store/gildash.ts'), () => __origGildashStore);
  void mock.module(nodePath.resolve(import.meta.dir, '../../shared/runtime-context.ts'), () => __origRuntimeContext);
  void mock.module(nodePath.resolve(import.meta.dir, '../../shared/tool-version.ts'), () => __origToolVersion);
});
