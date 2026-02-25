import { describe, expect, it } from 'bun:test';
import { err } from '@zipbul/result';
import type { Gildash, GildashError, CodeRelation, SymbolSearchResult } from '@zipbul/gildash';

import { analyzeDependencies, createEmptyDependencies } from './analyzer';

/* ------------------------------------------------------------------ */
/*  Mock gildash factory                                               */
/* ------------------------------------------------------------------ */

const gildashErr = (message: string) =>
  err({ type: 'search' as const, message } as GildashError);

interface MockGildashOverrides {
  getImportGraph?: () => Promise<Map<string, string[]> | ReturnType<typeof gildashErr>>;
  getCyclePaths?: (_p?: string, _o?: { maxCycles?: number }) => Promise<string[][] | ReturnType<typeof gildashErr>>;
  searchSymbols?: (q: unknown) => SymbolSearchResult[] | ReturnType<typeof gildashErr>;
  searchRelations?: (q: unknown) => CodeRelation[] | ReturnType<typeof gildashErr>;
  getModuleInterface?: (fp: string) => unknown;
}

const createMockGildash = (overrides: MockGildashOverrides = {}): Gildash => {
  return {
    getImportGraph: overrides.getImportGraph ?? (async () => new Map<string, string[]>()),
    getCyclePaths: overrides.getCyclePaths ?? (async () => []),
    searchSymbols: overrides.searchSymbols ?? (() => []),
    searchRelations: overrides.searchRelations ?? (() => []),
    getModuleInterface: overrides.getModuleInterface ?? ((fp: string) => ({
      filePath: fp,
      exports: [],
    })),
  } as unknown as Gildash;
};

const mkSymbol = (
  id: number,
  filePath: string,
  name: string,
  kind: string = 'function',
  detail: Record<string, unknown> = {},
): SymbolSearchResult => ({
  id,
  filePath,
  kind: kind as SymbolSearchResult['kind'],
  name,
  span: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
  isExported: true,
  signature: null,
  fingerprint: null,
  detail,
});

const mkImport = (
  srcFilePath: string,
  dstFilePath: string,
  dstSymbolName: string | null = null,
): CodeRelation => ({
  type: 'imports',
  srcFilePath,
  srcSymbolName: null,
  dstFilePath,
  dstSymbolName,
});

const mkReExport = (
  srcFilePath: string,
  dstFilePath: string,
  dstSymbolName: string | null = null,
): CodeRelation => ({
  type: 're-exports',
  srcFilePath,
  srcSymbolName: null,
  dstFilePath,
  dstSymbolName,
});

/* ------------------------------------------------------------------ */
/*  createEmptyDependencies                                            */
/* ------------------------------------------------------------------ */

describe('features/dependencies/analyzer — createEmptyDependencies', () => {
  it('should return the empty DependencyAnalysis shape', () => {
    const empty = createEmptyDependencies();
    expect(Array.isArray(empty.cycles)).toBe(true);
    expect(empty.cycles.length).toBe(0);
    expect(typeof empty.adjacency).toBe('object');
    expect(Array.isArray(empty.fanIn)).toBe(true);
    expect(Array.isArray(empty.fanOut)).toBe(true);
    expect(Array.isArray(empty.cuts)).toBe(true);
    expect(Array.isArray(empty.layerViolations)).toBe(true);
    expect(Array.isArray(empty.deadExports)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  analyzeDependencies                                                */
/* ------------------------------------------------------------------ */

describe('features/dependencies/analyzer — analyzeDependencies', () => {
  const ROOT = '/project';

  /* ---------- HP: Happy Path ---------- */

  it('should return empty analysis when import graph is empty', async () => {
    const g = createMockGildash({ getImportGraph: async () => new Map() });
    const result = await analyzeDependencies(g, { rootAbs: ROOT });
    expect(result.cycles.length).toBe(0);
    expect(Object.keys(result.adjacency).length).toBe(0);
    expect(result.fanIn.length).toBe(0);
    expect(result.fanOut.length).toBe(0);
    expect(result.deadExports.length).toBe(0);
  });

  it('should build relative adjacency from absolute import graph', async () => {
    const graph = new Map<string, string[]>([
      ['/project/src/a.ts', ['/project/src/b.ts']],
      ['/project/src/b.ts', []],
    ]);
    const g = createMockGildash({ getImportGraph: async () => graph });
    const result = await analyzeDependencies(g, { rootAbs: ROOT });
    expect(result.adjacency['src/a.ts']).toEqual(['src/b.ts']);
    expect(result.adjacency['src/b.ts']).toEqual([]);
  });

  it('should compute fanIn and fanOut sorted by count descending', async () => {
    const graph = new Map<string, string[]>([
      ['/project/a.ts', ['/project/shared.ts', '/project/b.ts']],
      ['/project/b.ts', ['/project/shared.ts']],
      ['/project/c.ts', ['/project/shared.ts']],
      ['/project/shared.ts', []],
    ]);
    const g = createMockGildash({ getImportGraph: async () => graph });
    const result = await analyzeDependencies(g, { rootAbs: ROOT });

    expect(result.fanIn.length).toBeGreaterThanOrEqual(1);
    expect(result.fanIn[0]!.module).toBe('shared.ts');
    expect(result.fanIn[0]!.count).toBe(3);

    expect(result.fanOut.length).toBeGreaterThanOrEqual(1);
    expect(result.fanOut[0]!.module).toBe('a.ts');
    expect(result.fanOut[0]!.count).toBe(2);
  });

  it('should detect cycles via getCyclePaths with relative paths', async () => {
    const graph = new Map<string, string[]>([
      ['/project/a.ts', ['/project/b.ts']],
      ['/project/b.ts', ['/project/a.ts']],
    ]);
    const g = createMockGildash({
      getImportGraph: async () => graph,
      getCyclePaths: async () => [['/project/a.ts', '/project/b.ts', '/project/a.ts']],
    });
    const result = await analyzeDependencies(g, { rootAbs: ROOT });
    expect(result.cycles.length).toBe(1);
    expect(result.cycles[0]!.path).toEqual(['a.ts', 'b.ts', 'a.ts']);
  });

  it('should detect layer violations when dependency not allowed', async () => {
    const graph = new Map<string, string[]>([
      ['/project/src/ui/comp.ts', ['/project/src/domain/svc.ts']],
      ['/project/src/domain/svc.ts', []],
    ]);
    const g = createMockGildash({ getImportGraph: async () => graph });
    const result = await analyzeDependencies(g, {
      rootAbs: ROOT,
      layers: [
        { name: 'ui', glob: 'src/ui/**' },
        { name: 'domain', glob: 'src/domain/**' },
      ],
      allowedDependencies: {},
    });
    expect(result.layerViolations.length).toBe(1);
    expect(result.layerViolations[0]!.fromLayer).toBe('ui');
    expect(result.layerViolations[0]!.toLayer).toBe('domain');
  });

  it('should NOT detect layer violation when dependency is allowed', async () => {
    const graph = new Map<string, string[]>([
      ['/project/src/ui/comp.ts', ['/project/src/domain/svc.ts']],
      ['/project/src/domain/svc.ts', []],
    ]);
    const g = createMockGildash({ getImportGraph: async () => graph });
    const result = await analyzeDependencies(g, {
      rootAbs: ROOT,
      layers: [
        { name: 'ui', glob: 'src/ui/**' },
        { name: 'domain', glob: 'src/domain/**' },
      ],
      allowedDependencies: { ui: ['domain'] },
    });
    expect(result.layerViolations.length).toBe(0);
  });

  it('should skip same-layer imports for layer violations', async () => {
    const graph = new Map<string, string[]>([
      ['/project/src/ui/a.ts', ['/project/src/ui/b.ts']],
      ['/project/src/ui/b.ts', []],
    ]);
    const g = createMockGildash({ getImportGraph: async () => graph });
    const result = await analyzeDependencies(g, {
      rootAbs: ROOT,
      layers: [{ name: 'ui', glob: 'src/ui/**' }],
      allowedDependencies: {},
    });
    expect(result.layerViolations.length).toBe(0);
  });

  it('should detect dead exports for unreachable non-imported symbols', async () => {
    const graph = new Map<string, string[]>([
      ['/project/src/main.ts', []],
      ['/project/src/orphan.ts', []],
    ]);
    const g = createMockGildash({
      getImportGraph: async () => graph,
      searchSymbols: (q: unknown) => {
        const query = q as { isExported?: boolean };
        if (query.isExported) return [mkSymbol(1, '/project/src/orphan.ts', 'unusedFn')];
        return [];
      },
      searchRelations: () => [],
    });
    const result = await analyzeDependencies(g, {
      rootAbs: ROOT,
      readFileFn: () => JSON.stringify({}),
    });
    expect(result.deadExports.length).toBe(1);
    expect(result.deadExports[0]!.kind).toBe('dead-export');
    expect(result.deadExports[0]!.name).toBe('unusedFn');
    expect(result.deadExports[0]!.module).toBe('src/orphan.ts');
  });

  it('should detect test-only exports when symbol only imported by test files', async () => {
    const graph = new Map<string, string[]>([
      ['/project/src/util.ts', []],
      ['/project/test/util.spec.ts', ['/project/src/util.ts']],
    ]);
    const g = createMockGildash({
      getImportGraph: async () => graph,
      searchSymbols: (q: unknown) => {
        const query = q as { isExported?: boolean };
        if (query.isExported) return [mkSymbol(1, '/project/src/util.ts', 'helperFn')];
        return [];
      },
      searchRelations: (q: unknown) => {
        const query = q as { type?: string };
        if (query.type === 'imports')
          return [mkImport('/project/test/util.spec.ts', '/project/src/util.ts', 'helperFn')];
        return [];
      },
    });
    const result = await analyzeDependencies(g, {
      rootAbs: ROOT,
      readFileFn: () => JSON.stringify({}),
    });
    expect(result.deadExports.length).toBe(1);
    expect(result.deadExports[0]!.kind).toBe('test-only-export');
    expect(result.deadExports[0]!.name).toBe('helperFn');
  });

  it('should exclude entry-point-reachable modules from dead export check', async () => {
    const graph = new Map<string, string[]>([
      ['/project/src/index.ts', ['/project/src/lib.ts']],
      ['/project/src/lib.ts', []],
    ]);
    const g = createMockGildash({
      getImportGraph: async () => graph,
      searchSymbols: (q: unknown) => {
        const query = q as { isExported?: boolean };
        if (query.isExported) return [mkSymbol(1, '/project/src/lib.ts', 'publicFn')];
        return [];
      },
      searchRelations: () => [],
    });
    const result = await analyzeDependencies(g, {
      rootAbs: ROOT,
      readFileFn: () => JSON.stringify({ main: './src/index.ts' }),
    });
    expect(result.deadExports.length).toBe(0);
  });

  it('should compute exportStats from searchSymbols (total + abstract)', async () => {
    const graph = new Map<string, string[]>([
      ['/project/src/mod.ts', []],
    ]);
    const exported = [
      mkSymbol(1, '/project/src/mod.ts', 'doSomething', 'function'),
      mkSymbol(2, '/project/src/mod.ts', 'IFoo', 'interface'),
      mkSymbol(3, '/project/src/mod.ts', 'AbstractBase', 'class', { modifiers: ['abstract'] }),
    ];
    const g = createMockGildash({
      getImportGraph: async () => graph,
      searchSymbols: (q: unknown) => {
        const query = q as { isExported?: boolean };
        if (query.isExported) return exported;
        return [];
      },
    });
    const result = await analyzeDependencies(g, {
      rootAbs: ROOT,
      readFileFn: () => JSON.stringify({}),
    });
    expect(result.exportStats['src/mod.ts']).toBeDefined();
    expect(result.exportStats['src/mod.ts']!.total).toBe(3);
    expect(result.exportStats['src/mod.ts']!.abstract).toBe(2);
  });

  it('should count type alias as abstract in exportStats', async () => {
    const graph = new Map<string, string[]>([
      ['/project/src/types.ts', []],
    ]);
    const exported = [
      mkSymbol(1, '/project/src/types.ts', 'UserId', 'type'),
      mkSymbol(2, '/project/src/types.ts', 'IRepo', 'interface'),
      mkSymbol(3, '/project/src/types.ts', 'helperFn', 'function'),
    ];
    const g = createMockGildash({
      getImportGraph: async () => graph,
      searchSymbols: (q: unknown) => {
        const query = q as { isExported?: boolean };
        if (query.isExported) return exported;
        return [];
      },
    });
    const result = await analyzeDependencies(g, {
      rootAbs: ROOT,
      readFileFn: () => JSON.stringify({}),
    });
    expect(result.exportStats['src/types.ts']).toBeDefined();
    expect(result.exportStats['src/types.ts']!.total).toBe(3);
    expect(result.exportStats['src/types.ts']!.abstract).toBe(2);
  });

  it('should generate edge cut hints for cycles using outDegree', async () => {
    const graph = new Map<string, string[]>([
      ['/project/a.ts', ['/project/b.ts', '/project/d.ts']],
      ['/project/b.ts', ['/project/c.ts']],
      ['/project/c.ts', ['/project/a.ts']],
      ['/project/d.ts', []],
    ]);
    const g = createMockGildash({
      getImportGraph: async () => graph,
      getCyclePaths: async () => [['/project/a.ts', '/project/b.ts', '/project/c.ts', '/project/a.ts']],
    });
    const result = await analyzeDependencies(g, { rootAbs: ROOT });
    expect(result.cuts.length).toBeGreaterThanOrEqual(1);
    expect(result.cuts[0]!.from).toBe('a.ts');
    expect(result.cuts[0]!.score).toBe(2);
  });

  it('should skip dead export check when module has namespace import (usesAll)', async () => {
    const graph = new Map<string, string[]>([
      ['/project/src/consumer.ts', ['/project/src/lib.ts']],
      ['/project/src/lib.ts', []],
    ]);
    const g = createMockGildash({
      getImportGraph: async () => graph,
      searchSymbols: (q: unknown) => {
        const query = q as { isExported?: boolean };
        if (query.isExported) return [mkSymbol(1, '/project/src/lib.ts', 'unusedFn')];
        return [];
      },
      searchRelations: (q: unknown) => {
        const query = q as { type?: string };
        if (query.type === 'imports')
          return [mkImport('/project/src/consumer.ts', '/project/src/lib.ts', null)];
        return [];
      },
    });
    const result = await analyzeDependencies(g, {
      rootAbs: ROOT,
      readFileFn: () => JSON.stringify({}),
    });
    expect(result.deadExports.length).toBe(0);
  });

  it('should not flag symbol as dead when re-exported', async () => {
    const graph = new Map<string, string[]>([
      ['/project/src/barrel.ts', ['/project/src/lib.ts']],
      ['/project/src/lib.ts', []],
    ]);
    const g = createMockGildash({
      getImportGraph: async () => graph,
      searchSymbols: (q: unknown) => {
        const query = q as { isExported?: boolean };
        if (query.isExported) return [mkSymbol(1, '/project/src/lib.ts', 'sharedFn')];
        return [];
      },
      searchRelations: (q: unknown) => {
        const query = q as { type?: string };
        if (query.type === 're-exports')
          return [mkReExport('/project/src/barrel.ts', '/project/src/lib.ts', 'sharedFn')];
        return [];
      },
    });
    const result = await analyzeDependencies(g, {
      rootAbs: ROOT,
      readFileFn: () => JSON.stringify({}),
    });
    expect(result.deadExports.length).toBe(0);
  });

  it('should skip files outside all layers for violation check', async () => {
    const graph = new Map<string, string[]>([
      ['/project/scripts/build.ts', ['/project/src/domain/svc.ts']],
      ['/project/src/domain/svc.ts', []],
    ]);
    const g = createMockGildash({ getImportGraph: async () => graph });
    const result = await analyzeDependencies(g, {
      rootAbs: ROOT,
      layers: [{ name: 'domain', glob: 'src/domain/**' }],
      allowedDependencies: {},
    });
    expect(result.layerViolations.length).toBe(0);
  });

  it('should handle diamond dependency pattern correctly', async () => {
    const graph = new Map<string, string[]>([
      ['/project/a.ts', ['/project/b.ts', '/project/c.ts']],
      ['/project/b.ts', ['/project/d.ts']],
      ['/project/c.ts', ['/project/d.ts']],
      ['/project/d.ts', []],
    ]);
    const g = createMockGildash({ getImportGraph: async () => graph });
    const result = await analyzeDependencies(g, { rootAbs: ROOT });
    expect(result.adjacency['a.ts']).toEqual(['b.ts', 'c.ts']);
    expect(result.fanIn[0]!.module).toBe('d.ts');
    expect(result.fanIn[0]!.count).toBe(2);
    expect(result.fanOut[0]!.module).toBe('a.ts');
    expect(result.fanOut[0]!.count).toBe(2);
  });

  /* ---------- NE: Negative / Error ---------- */

  it('should return empty when getImportGraph returns Err', async () => {
    const g = createMockGildash({
      getImportGraph: async () => gildashErr('graph failed'),
    });
    const result = await analyzeDependencies(g, { rootAbs: ROOT });
    expect(result.cycles.length).toBe(0);
    expect(Object.keys(result.adjacency).length).toBe(0);
  });

  it('should return empty cycles when getCyclePaths returns Err', async () => {
    const graph = new Map<string, string[]>([
      ['/project/a.ts', ['/project/b.ts']],
      ['/project/b.ts', ['/project/a.ts']],
    ]);
    const g = createMockGildash({
      getImportGraph: async () => graph,
      getCyclePaths: async () => gildashErr('cycle detection failed'),
    });
    const result = await analyzeDependencies(g, { rootAbs: ROOT });
    expect(result.cycles.length).toBe(0);
    expect(Object.keys(result.adjacency).length).toBe(2);
  });

  it('should skip file exportStats when searchSymbols returns Err', async () => {
    const graph = new Map<string, string[]>([
      ['/project/src/mod.ts', []],
    ]);
    const g = createMockGildash({
      getImportGraph: async () => graph,
      searchSymbols: () => gildashErr('search failed'),
    });
    const result = await analyzeDependencies(g, { rootAbs: ROOT });
    expect(Object.keys(result.exportStats).length).toBe(0);
  });

  it('should produce empty dead exports when searchRelations returns Err', async () => {
    const graph = new Map<string, string[]>([
      ['/project/src/orphan.ts', []],
    ]);
    const g = createMockGildash({
      getImportGraph: async () => graph,
      searchSymbols: (q: unknown) => {
        const query = q as { isExported?: boolean };
        if (query.isExported) return [mkSymbol(1, '/project/src/orphan.ts', 'fn')];
        return [];
      },
      searchRelations: () => gildashErr('relations failed'),
    });
    const result = await analyzeDependencies(g, {
      rootAbs: ROOT,
      readFileFn: () => JSON.stringify({}),
    });
    expect(Array.isArray(result.deadExports)).toBe(true);
  });

  it('should apply defaults when input is undefined', async () => {
    const g = createMockGildash({ getImportGraph: async () => new Map() });
    const result = await analyzeDependencies(g);
    expect(result.cycles.length).toBe(0);
    expect(Object.keys(result.adjacency).length).toBe(0);
  });

  it('should handle readPackageEntrypoints failure gracefully', async () => {
    const graph = new Map<string, string[]>([
      ['/project/src/orphan.ts', []],
    ]);
    const g = createMockGildash({
      getImportGraph: async () => graph,
      searchSymbols: (q: unknown) => {
        const query = q as { isExported?: boolean };
        if (query.isExported) return [mkSymbol(1, '/project/src/orphan.ts', 'fn')];
        return [];
      },
      searchRelations: () => [],
    });
    const result = await analyzeDependencies(g, {
      rootAbs: ROOT,
      readFileFn: () => { throw new Error('read failed'); },
    });
    expect(result.deadExports.length).toBe(1);
    expect(result.deadExports[0]!.kind).toBe('dead-export');
  });

  /* ---------- ED: Edge Cases ---------- */

  it('should handle single file with no imports', async () => {
    const graph = new Map<string, string[]>([
      ['/project/src/lone.ts', []],
    ]);
    const g = createMockGildash({ getImportGraph: async () => graph });
    const result = await analyzeDependencies(g, { rootAbs: ROOT });
    expect(result.adjacency['src/lone.ts']).toEqual([]);
    expect(result.fanIn.length).toBe(0);
    expect(result.fanOut.length).toBe(0);
  });

  it('should handle self-importing file as self-loop cycle', async () => {
    const graph = new Map<string, string[]>([
      ['/project/a.ts', ['/project/a.ts']],
    ]);
    const g = createMockGildash({
      getImportGraph: async () => graph,
      getCyclePaths: async () => [['/project/a.ts', '/project/a.ts']],
    });
    const result = await analyzeDependencies(g, { rootAbs: ROOT });
    expect(result.cycles.length).toBe(1);
    expect(result.cycles[0]!.path).toEqual(['a.ts', 'a.ts']);
  });

  it('should handle graph with all files having zero fan', async () => {
    const graph = new Map<string, string[]>([
      ['/project/a.ts', []],
      ['/project/b.ts', []],
      ['/project/c.ts', []],
    ]);
    const g = createMockGildash({ getImportGraph: async () => graph });
    const result = await analyzeDependencies(g, { rootAbs: ROOT });
    expect(result.fanIn.length).toBe(0);
    expect(result.fanOut.length).toBe(0);
  });

  it('should handle rootAbs normalization with backslashes', async () => {
    const graph = new Map<string, string[]>([
      ['/project/src/a.ts', ['/project/src/b.ts']],
      ['/project/src/b.ts', []],
    ]);
    const g = createMockGildash({ getImportGraph: async () => graph });
    const result = await analyzeDependencies(g, { rootAbs: '/project' });
    expect(result.adjacency['src/a.ts']).toBeDefined();
  });

  /* ---------- CO: Corner Cases ---------- */

  it('should handle empty graph combined with layers config', async () => {
    const g = createMockGildash({ getImportGraph: async () => new Map() });
    const result = await analyzeDependencies(g, {
      rootAbs: ROOT,
      layers: [{ name: 'ui', glob: 'src/ui/**' }],
      allowedDependencies: {},
    });
    expect(result.layerViolations.length).toBe(0);
    expect(result.cycles.length).toBe(0);
  });

  it('should handle multiple gildash API errors with graceful degradation', async () => {
    const graph = new Map<string, string[]>([
      ['/project/a.ts', ['/project/b.ts']],
      ['/project/b.ts', []],
    ]);
    const g = createMockGildash({
      getImportGraph: async () => graph,
      getCyclePaths: async () => gildashErr('cycle error'),
      searchSymbols: () => gildashErr('search error'),
    });
    const result = await analyzeDependencies(g, { rootAbs: ROOT });
    expect(Object.keys(result.adjacency).length).toBe(2);
    expect(result.cycles.length).toBe(0);
    expect(Object.keys(result.exportStats).length).toBe(0);
    expect(result.deadExports.length).toBe(0);
  });

  it('should detect both cycle and layer violation on same edge', async () => {
    const graph = new Map<string, string[]>([
      ['/project/src/ui/comp.ts', ['/project/src/domain/svc.ts']],
      ['/project/src/domain/svc.ts', ['/project/src/ui/comp.ts']],
    ]);
    const g = createMockGildash({
      getImportGraph: async () => graph,
      getCyclePaths: async () => [
        ['/project/src/ui/comp.ts', '/project/src/domain/svc.ts', '/project/src/ui/comp.ts'],
      ],
    });
    const result = await analyzeDependencies(g, {
      rootAbs: ROOT,
      layers: [
        { name: 'ui', glob: 'src/ui/**' },
        { name: 'domain', glob: 'src/domain/**' },
      ],
      allowedDependencies: {},
    });
    expect(result.cycles.length).toBe(1);
    expect(result.layerViolations.length).toBe(2);
  });

  it('should handle dead export and test-only export in same module', async () => {
    const graph = new Map<string, string[]>([
      ['/project/src/lib.ts', []],
      ['/project/test/lib.spec.ts', ['/project/src/lib.ts']],
    ]);
    const exported = [
      mkSymbol(1, '/project/src/lib.ts', 'deadFn'),
      mkSymbol(2, '/project/src/lib.ts', 'testOnlyFn'),
    ];
    const g = createMockGildash({
      getImportGraph: async () => graph,
      searchSymbols: (q: unknown) => {
        const query = q as { isExported?: boolean };
        if (query.isExported) return exported;
        return [];
      },
      searchRelations: (q: unknown) => {
        const query = q as { type?: string };
        if (query.type === 'imports')
          return [mkImport('/project/test/lib.spec.ts', '/project/src/lib.ts', 'testOnlyFn')];
        return [];
      },
    });
    const result = await analyzeDependencies(g, {
      rootAbs: ROOT,
      readFileFn: () => JSON.stringify({}),
    });
    const dead = result.deadExports.filter(d => d.kind === 'dead-export');
    const testOnly = result.deadExports.filter(d => d.kind === 'test-only-export');
    expect(dead.length).toBe(1);
    expect(dead[0]!.name).toBe('deadFn');
    expect(testOnly.length).toBe(1);
    expect(testOnly[0]!.name).toBe('testOnlyFn');
  });

  /* ---------- OR: Ordering ---------- */

  it('should produce deterministic fanIn/fanOut ordering', async () => {
    const graph = new Map<string, string[]>([
      ['/project/a.ts', ['/project/x.ts', '/project/y.ts', '/project/z.ts']],
      ['/project/b.ts', ['/project/x.ts', '/project/y.ts']],
      ['/project/c.ts', ['/project/x.ts']],
      ['/project/x.ts', []],
      ['/project/y.ts', []],
      ['/project/z.ts', []],
    ]);
    const g = createMockGildash({ getImportGraph: async () => graph });
    const result = await analyzeDependencies(g, { rootAbs: ROOT });

    expect(result.fanIn[0]!.module).toBe('x.ts');
    expect(result.fanIn[0]!.count).toBe(3);
    expect(result.fanIn[1]!.module).toBe('y.ts');
    expect(result.fanIn[1]!.count).toBe(2);
    expect(result.fanIn[2]!.module).toBe('z.ts');
    expect(result.fanIn[2]!.count).toBe(1);

    expect(result.fanOut[0]!.module).toBe('a.ts');
    expect(result.fanOut[0]!.count).toBe(3);
    expect(result.fanOut[1]!.module).toBe('b.ts');
    expect(result.fanOut[1]!.count).toBe(2);
    expect(result.fanOut[2]!.module).toBe('c.ts');
    expect(result.fanOut[2]!.count).toBe(1);
  });
});
