import type { Gildash, StoredCodeRelation, SymbolSearchResult } from '@zipbul/gildash';

import { GildashError } from '@zipbul/gildash';
import { describe, expect, it } from 'bun:test';

import { expectNoFanInOut } from '../../../test/integration/shared/test-kit';
import { analyzeDependencies, createEmptyDependencies } from './analyzer';

type Deps = Awaited<ReturnType<typeof analyzeDependencies>>;

/** Assert a dependency analysis has no cycles and an empty adjacency graph. */
const expectEmptyDepsGraph = (result: Deps): void => {
  expect(result.cycles.length).toBe(0);
  expect(Object.keys(result.adjacency).length).toBe(0);
};

/** A `searchSymbols` stub that returns `results` only for `isExported` queries. */
const searchExported =
  <T>(results: T[]) =>
  (q: unknown): T[] =>
    (q as { isExported?: boolean }).isExported ? results : [];

/** Assert the first fan-out entry is `module` with `count` dependents. */
const expectFirstFanOut = (result: Deps, module: string, count: number): void => {
  expect(result.fanOut[0]!.module).toBe(module);
  expect(result.fanOut[0]!.count).toBe(count);
};

/** Assert exactly one dead export, tagged `dead-export`. */
const expectSingleDeadExport = (result: Deps): void => {
  expect(result.deadExports.length).toBe(1);
  expect(result.deadExports[0]!.kind).toBe('dead-export');
};

/** Dead exports re-exported through `src/index.ts`. */
const indexDeadExports = (result: Deps): Deps['deadExports'] => result.deadExports.filter(d => d.module === 'src/index.ts');

/** Assert `arr` is a single entry whose `name` is `name`. */
const expectSingleNamed = (arr: ReadonlyArray<{ readonly name: string }>, name: string): void => {
  expect(arr.length).toBe(1);
  expect(arr[0]!.name).toBe(name);
};

/* ------------------------------------------------------------------ */
/*  Mock gildash factory                                               */
/* ------------------------------------------------------------------ */

const gildashThrow = (message: string): never => {
  throw new GildashError('search', message);
};

interface MockGildashOverrides {
  getImportGraph?: () => Promise<Map<string, string[]>>;
  getCyclePaths?: (_p?: string, _o?: { maxCycles?: number }) => Promise<string[][]>;
  searchSymbols?: (q: unknown) => SymbolSearchResult[];
  searchRelations?: (q: unknown) => StoredCodeRelation[];
  getModuleInterface?: (fp: string) => unknown;
  resolveSymbol?: (name: string, filePath: string) => unknown;
  getSymbolsByFile?: (filePath: string) => ReadonlyArray<unknown>;
}

const createMockGildash = (overrides: MockGildashOverrides = {}): Gildash => {
  return {
    getImportGraph: overrides.getImportGraph ?? (async () => new Map<string, string[]>()),
    getCyclePaths: overrides.getCyclePaths ?? (async () => []),
    searchSymbols: overrides.searchSymbols ?? (() => []),
    searchRelations: overrides.searchRelations ?? (() => []),
    getModuleInterface:
      overrides.getModuleInterface ??
      ((fp: string) => ({
        filePath: fp,
        exports: [],
      })),
    resolveSymbol:
      overrides.resolveSymbol ??
      ((name: string, filePath: string) => ({
        originalName: name,
        originalFilePath: filePath,
        reExportChain: [],
        circular: false,
      })),
    getSymbolsByFile: overrides.getSymbolsByFile ?? (() => []),
  } as unknown as Gildash;
};

/** Mock gildash whose import graph is the canonical `src/a.ts → src/b.ts` pair. */
const makeAbGraphGildash = (): Gildash =>
  createMockGildash({
    getImportGraph: async () =>
      new Map<string, string[]>([
        ['/project/src/a.ts', ['/project/src/b.ts']],
        ['/project/src/b.ts', []],
      ]),
  });

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
  memberName: null,
  detail,
});

const mkImport = (
  srcFilePath: string,
  dstFilePath: string | null,
  dstSymbolName: string | null = null,
  extra: { isExternal?: boolean; specifier?: string | null; srcSymbolName?: string | null } = {},
): StoredCodeRelation => ({
  type: 'imports',
  srcFilePath,
  srcSymbolName: extra.srcSymbolName ?? null,
  dstFilePath,
  dstSymbolName,
  dstProject: null,
  isExternal: extra.isExternal ?? false,
  specifier: extra.specifier ?? null,
});

const mkReExport = (
  srcFilePath: string,
  dstFilePath: string,
  dstSymbolName: string | null = null,
  srcSymbolName: string | null = null,
): StoredCodeRelation => ({
  type: 're-exports',
  srcFilePath,
  srcSymbolName,
  dstFilePath,
  dstSymbolName,
  dstProject: null,
  isExternal: false,
  specifier: null,
});

const mkTypeRef = (
  srcFilePath: string,
  dstFilePath: string,
  symbolName: string,
  isReExport: boolean = false,
): StoredCodeRelation => ({
  type: 'type-references' as StoredCodeRelation['type'],
  srcFilePath,
  srcSymbolName: symbolName,
  dstFilePath,
  dstSymbolName: symbolName,
  dstProject: null,
  isExternal: false,
  specifier: null,
  ...(isReExport ? { meta: { isReExport: true } } : {}),
});

interface UnusedDepExpectation {
  kind: 'unused-dependency' | 'unlisted-dependency';
  packageName: string;
}

interface UnresolvedExpectation {
  specifier: string;
  module: string;
}

interface ImportClassificationCase {
  name: string;
  imports: ReadonlyArray<StoredCodeRelation>;
  pkgJson: Record<string, unknown>;
  ignoreDependencies?: ReadonlyArray<string>;
  expectedUnusedDeps: ReadonlyArray<UnusedDepExpectation>;
  expectedUnresolved: ReadonlyArray<UnresolvedExpectation>;
}

interface ExportStatsCase {
  name: string;
  exported: ReadonlyArray<SymbolSearchResult>;
  module: string;
  expectedTotal: number;
  expectedAbstract: number;
}

interface LayerViolationExpectation {
  fromLayer: string;
  toLayer: string;
}

interface DependencyLayer {
  name: string;
  glob: string;
}

interface LayerViolationCase {
  name: string;
  graph: Map<string, string[]>;
  layers: ReadonlyArray<DependencyLayer>;
  allowedDependencies: Readonly<Record<string, ReadonlyArray<string>>>;
  expectedViolations: ReadonlyArray<LayerViolationExpectation>;
}

interface NoDuplicateExportCase {
  name: string;
  exported: ReadonlyArray<SymbolSearchResult>;
}

interface UnusedFilesCase {
  name: string;
  graph: Map<string, string[]>;
  main: string;
  expectedUnusedFileModules: ReadonlyArray<string>;
}

interface MemberDetectionCase {
  name: string;
  container: SymbolSearchResult;
  containerFile: string;
  importName: string;
  calledMembers: ReadonlyArray<string>;
  members: ReadonlyArray<MemberSymbolRow>;
  expectedKind: string;
  expectedUnusedMemberNames: ReadonlyArray<string>;
}

const mkCall = (srcFilePath: string, dstFilePath: string, dstSymbolName: string): StoredCodeRelation => ({
  type: 'calls' as StoredCodeRelation['type'],
  srcFilePath,
  srcSymbolName: null,
  dstFilePath,
  dstSymbolName,
  dstProject: null,
  isExternal: false,
  specifier: null,
});

/** Assert exactly one unresolved-import finding whose specifier is './missing'. */
const expectSingleMissingUnresolved = (result: { unresolvedImports: ReadonlyArray<{ specifier: string }> }): void => {
  expect(result.unresolvedImports.length).toBe(1);
  expect(result.unresolvedImports[0]!.specifier).toBe('./missing');
};


/** A `searchSymbols` mock that returns `exported` only for the `isExported` query. */
const exportedSymbols =
  (exported: ReadonlyArray<SymbolSearchResult>) =>
  (q: unknown): SymbolSearchResult[] =>
    (q as { isExported?: boolean }).isExported === true ? [...exported] : [];

/**
 * A `resolveSymbol` mock where symbols named `sharedName` all resolve to the single
 * `origin` file (a shared re-export origin), and every other symbol resolves to itself.
 */
const resolveSymbolToOrigin = (sharedName: string, origin: string) => (name: string, filePath: string) => ({
  originalName: name,
  originalFilePath: name === sharedName ? origin : filePath,
  reExportChain: [],
  circular: false,
});

/** A `searchRelations` mock that returns `rels` only for queries of the given `type`. */
const relationsOfType =
  (type: StoredCodeRelation['type'], rels: ReadonlyArray<StoredCodeRelation>) =>
  (q: unknown): StoredCodeRelation[] =>
    (q as { type?: string }).type === type ? [...rels] : [];

/** A `searchRelations` mock that dispatches on query `type` via a `type → relations` map. */
const relationsByType =
  (byType: Readonly<Record<string, ReadonlyArray<StoredCodeRelation>>>) =>
  (q: unknown): StoredCodeRelation[] => {
    const rels = byType[(q as { type?: string }).type ?? ''];

    return rels === undefined ? [] : [...rels];
  };

interface MemberSymbolRow {
  kind: string;
  name: string;
  memberName: string | null;
  isExported: boolean;
}

/**
 * `getSymbolsByFile` mock for the cross-file member-attribution tests: returns a
 * `Guards` namespace with `isString` / `isNumber` members for `src/guards.ts`,
 * and `[]` for every other file. Shared by the two B2 attribution cases.
 */
const guardsFileSymbols = (filePath: string): ReadonlyArray<MemberSymbolRow> =>
  filePath === 'src/guards.ts'
    ? [
        { kind: 'namespace', name: 'Guards', memberName: null, isExported: true },
        { kind: 'function', name: 'Guards.isString', memberName: 'isString', isExported: false },
        { kind: 'function', name: 'Guards.isNumber', memberName: 'isNumber', isExported: false },
      ]
    : [];

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
    expect(Array.isArray(empty.unusedFiles)).toBe(true);
    expect(empty.unusedFiles.length).toBe(0);
    expect(Array.isArray(empty.unusedDeps)).toBe(true);
    expect(empty.unusedDeps.length).toBe(0);
    expect(Array.isArray(empty.unresolvedImports)).toBe(true);
    expect(empty.unresolvedImports.length).toBe(0);
    expect(Array.isArray(empty.duplicateExports)).toBe(true);
    expect(empty.duplicateExports.length).toBe(0);
    expect(Array.isArray(empty.unusedMembers)).toBe(true);
    expect(empty.unusedMembers.length).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  analyzeDependencies                                                */
/* ------------------------------------------------------------------ */

describe('features/dependencies/analyzer — analyzeDependencies', () => {
  const ROOT = '/project';

  /**
   * Build a mock gildash whose only file is `src/index.ts`, whose `searchRelations`
   * returns the given `imports` for `type: 'imports'`, and run the analyzer against a
   * package.json produced from `pkgJson`. Collapses the shared mock-construction shared
   * by the unused/unlisted-dependency and unresolved-import tests.
   */
  const analyzeImports = async (
    imports: ReadonlyArray<StoredCodeRelation>,
    pkgJson: Record<string, unknown>,
    ignoreDependencies: ReadonlyArray<string> | undefined = [],
  ): Promise<Awaited<ReturnType<typeof analyzeDependencies>>> => {
    const graph = new Map<string, string[]>([['/project/src/index.ts', []]]);
    const g = createMockGildash({
      getImportGraph: async () => graph,
      searchSymbols: () => [],
      searchRelations: (q: unknown) => ((q as { type?: string }).type === 'imports' ? [...imports] : []),
    });

    return analyzeDependencies(g, { rootAbs: ROOT, readFileFn: () => JSON.stringify(pkgJson), ignoreDependencies });
  };

  /**
   * Build a mock gildash for the enum/namespace member-usage tests: `index.ts`
   * imports `container` (an enum or namespace) from `containerFile`, optionally
   * marking one member used via a `calls` relation, with `members` exposed through
   * `getSymbolsByFile`. Collapses the shared mock-construction across the
   * enum/namespace member detection tests.
   */
  const analyzeMembers = async (params: {
    container: SymbolSearchResult;
    containerFile: string;
    importName: string;
    calledMembers: ReadonlyArray<string>;
    members: ReadonlyArray<MemberSymbolRow>;
  }): Promise<Awaited<ReturnType<typeof analyzeDependencies>>> => {
    const relFile = params.containerFile.replace('/project/', '');
    const graph = new Map<string, string[]>([
      ['/project/src/index.ts', [params.containerFile]],
      [params.containerFile, []],
    ]);
    const g = createMockGildash({
      getImportGraph: async () => graph,
      searchSymbols: exportedSymbols([params.container]),
      searchRelations: (q: unknown) => {
        const query = q as { type?: string };

        if (query.type === 'imports') {
          return [mkImport('/project/src/index.ts', params.containerFile, params.importName)];
        }

        if (query.type === 'calls') {
          return params.calledMembers.map(m => mkCall('/project/src/index.ts', params.containerFile, m));
        }

        return [];
      },
      getSymbolsByFile: (filePath: string) => (filePath === relFile ? [...params.members] : []),
    });

    return analyzeDependencies(g, { rootAbs: ROOT, readFileFn: () => JSON.stringify({ main: './src/index.ts' }) });
  };

  /**
   * Build a mock gildash whose `searchSymbols` returns `exported` for the `isExported`
   * query (and `[]` otherwise) over the given `graph`, with caller-supplied relation /
   * resolution overrides, then run the analyzer. Collapses the `getImportGraph` +
   * exported-`searchSymbols` mock skeleton shared by the dead-export / duplicate-export
   * tests while each caller keeps its own relations, resolution and assertions.
   */
  const analyzeWithExports = async (params: {
    graph: Map<string, string[]>;
    exported: ReadonlyArray<SymbolSearchResult>;
    searchRelations?: (q: unknown) => StoredCodeRelation[];
    resolveSymbol?: MockGildashOverrides['resolveSymbol'];
    pkgJson?: Record<string, unknown>;
  }): Promise<Awaited<ReturnType<typeof analyzeDependencies>>> => {
    const g = createMockGildash({
      getImportGraph: async () => params.graph,
      searchSymbols: exportedSymbols(params.exported),
      searchRelations: params.searchRelations ?? (() => []),
      ...(params.resolveSymbol === undefined ? {} : { resolveSymbol: params.resolveSymbol }),
    });

    return analyzeDependencies(g, {
      rootAbs: ROOT,
      ...(params.pkgJson === undefined ? {} : { readFileFn: () => JSON.stringify(params.pkgJson) }),
    });
  };

  /* ---------- HP: Happy Path ---------- */

  it('should return empty analysis when import graph is empty', async () => {
    const g = createMockGildash({ getImportGraph: async () => new Map() });
    const result = await analyzeDependencies(g, { rootAbs: ROOT });

    expectEmptyDepsGraph(result);
    expectNoFanInOut(result);
    expect(result.deadExports.length).toBe(0);
  });

  it('should build relative adjacency from absolute import graph', async () => {
    const g = makeAbGraphGildash();
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
    expectFirstFanOut(result, 'a.ts', 2);
  });

  it('should deduplicate repeated edges to the same module in adjacency and fan metrics', async () => {
    // a.ts imports b.ts twice (e.g. two import declarations to same module).
    // Previously fanIn=2 and fanOut=2 were reported because targets.length / per-target
    // increment counted duplicates.
    const graph = new Map<string, string[]>([
      ['/project/a.ts', ['/project/b.ts', '/project/b.ts']],
      ['/project/b.ts', []],
    ]);
    const g = createMockGildash({ getImportGraph: async () => graph });
    const result = await analyzeDependencies(g, { rootAbs: ROOT });

    expect(result.adjacency['a.ts']).toEqual(['b.ts']);

    const aFanOut = result.fanOut.find(entry => entry.module === 'a.ts');
    const bFanIn = result.fanIn.find(entry => entry.module === 'b.ts');

    expect(aFanOut?.count).toBe(1);
    expect(bFanIn?.count).toBe(1);
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

  const layerViolationCases: LayerViolationCase[] = [
    {
      name: 'detects layer violation when ui→domain dependency not allowed',
      graph: new Map([
        ['/project/src/ui/comp.ts', ['/project/src/domain/svc.ts']],
        ['/project/src/domain/svc.ts', []],
      ]),
      layers: [
        { name: 'ui', glob: 'src/ui/**' },
        { name: 'domain', glob: 'src/domain/**' },
      ],
      allowedDependencies: {},
      expectedViolations: [{ fromLayer: 'ui', toLayer: 'domain' }],
    },
    {
      name: 'does not flag ui→domain when allowedDependencies permits it',
      graph: new Map([
        ['/project/src/ui/comp.ts', ['/project/src/domain/svc.ts']],
        ['/project/src/domain/svc.ts', []],
      ]),
      layers: [
        { name: 'ui', glob: 'src/ui/**' },
        { name: 'domain', glob: 'src/domain/**' },
      ],
      allowedDependencies: { ui: ['domain'] },
      expectedViolations: [],
    },
    {
      name: 'skips same-layer imports for layer violations',
      graph: new Map([
        ['/project/src/ui/a.ts', ['/project/src/ui/b.ts']],
        ['/project/src/ui/b.ts', []],
      ]),
      layers: [{ name: 'ui', glob: 'src/ui/**' }],
      allowedDependencies: {},
      expectedViolations: [],
    },
    {
      name: 'skips files outside all layers for violation check',
      graph: new Map([
        ['/project/scripts/build.ts', ['/project/src/domain/svc.ts']],
        ['/project/src/domain/svc.ts', []],
      ]),
      layers: [{ name: 'domain', glob: 'src/domain/**' }],
      allowedDependencies: {},
      expectedViolations: [],
    },
  ];

  it.each(layerViolationCases)('$name', async ({ graph, layers, allowedDependencies, expectedViolations }) => {
    const g = createMockGildash({ getImportGraph: async () => graph });
    const result = await analyzeDependencies(g, { rootAbs: ROOT, layers, allowedDependencies });
    const actual = result.layerViolations.map(v => ({ fromLayer: v.fromLayer, toLayer: v.toLayer }));

    expect(actual).toEqual([...expectedViolations]);
  });

  it('should detect dead exports for unreachable non-imported symbols', async () => {
    const result = await analyzeWithExports({
      graph: new Map([
        ['/project/src/main.ts', ['/project/src/orphan.ts']],
        ['/project/src/orphan.ts', []],
      ]),
      exported: [mkSymbol(1, '/project/src/orphan.ts', 'unusedFn')],
      pkgJson: { main: './src/main.ts' },
    });

    expectSingleDeadExport(result);
    expect(result.deadExports[0]!.name).toBe('unusedFn');
    expect(result.deadExports[0]!.module).toBe('src/orphan.ts');
  });

  it('should report unreachable files as unused-file instead of dead-export', async () => {
    const result = await analyzeWithExports({
      graph: new Map([
        ['/project/src/main.ts', []],
        ['/project/src/orphan.ts', []],
      ]),
      exported: [mkSymbol(1, '/project/src/orphan.ts', 'unusedFn')],
      pkgJson: { main: './src/main.ts' },
    });

    expect(result.unusedFiles.length).toBe(1);
    expect(result.unusedFiles[0]!.module).toBe('src/orphan.ts');
    expect(result.deadExports.length).toBe(0);
  });

  it('should detect test-only exports when symbol only imported by test files', async () => {
    const result = await analyzeWithExports({
      graph: new Map([
        ['/project/src/main.ts', ['/project/src/util.ts']],
        ['/project/src/util.ts', []],
        ['/project/test/util.spec.ts', ['/project/src/util.ts']],
      ]),
      exported: [mkSymbol(1, '/project/src/util.ts', 'helperFn')],
      searchRelations: relationsOfType('imports', [mkImport('/project/test/util.spec.ts', '/project/src/util.ts', 'helperFn')]),
      pkgJson: { main: './src/main.ts' },
    });

    expect(result.deadExports.length).toBe(1);
    expect(result.deadExports[0]!.kind).toBe('test-only-export');
    expect(result.deadExports[0]!.name).toBe('helperFn');
  });

  it('should not report dead export for symbols that are actually imported', async () => {
    const result = await analyzeWithExports({
      graph: new Map([
        ['/project/src/index.ts', ['/project/src/lib.ts']],
        ['/project/src/lib.ts', []],
      ]),
      exported: [mkSymbol(1, '/project/src/lib.ts', 'publicFn')],
      searchRelations: relationsOfType('imports', [mkImport('/project/src/index.ts', '/project/src/lib.ts', 'publicFn')]),
      pkgJson: { main: './src/index.ts' },
    });

    expect(result.deadExports.length).toBe(0);
  });

  const exportStatsCases: ExportStatsCase[] = [
    {
      name: 'computes exportStats from searchSymbols (interface + abstract class counted as abstract)',
      exported: [
        mkSymbol(1, '/project/src/mod.ts', 'doSomething', 'function'),
        mkSymbol(2, '/project/src/mod.ts', 'IFoo', 'interface'),
        mkSymbol(3, '/project/src/mod.ts', 'AbstractBase', 'class', { modifiers: ['abstract'] }),
      ],
      module: 'src/mod.ts',
      expectedTotal: 3,
      expectedAbstract: 2,
    },
    {
      name: 'counts type alias and interface as abstract in exportStats',
      exported: [
        mkSymbol(1, '/project/src/types.ts', 'UserId', 'type'),
        mkSymbol(2, '/project/src/types.ts', 'IRepo', 'interface'),
        mkSymbol(3, '/project/src/types.ts', 'helperFn', 'function'),
      ],
      module: 'src/types.ts',
      expectedTotal: 3,
      expectedAbstract: 2,
    },
  ];

  it.each(exportStatsCases)('$name', async ({ exported, module, expectedTotal, expectedAbstract }) => {
    const graph = new Map<string, string[]>([[`/project/${module}`, []]]);
    const g = createMockGildash({ getImportGraph: async () => graph, searchSymbols: exportedSymbols(exported) });
    const result = await analyzeDependencies(g, { rootAbs: ROOT, readFileFn: () => JSON.stringify({}) });
    const stats = result.exportStats[module];

    expect(stats).toEqual({ total: expectedTotal, abstract: expectedAbstract });
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
    // import * as Lib from './lib' → dstSymbolName = '*' → usesAll.
    const result = await analyzeWithExports({
      graph: new Map([
        ['/project/src/consumer.ts', ['/project/src/lib.ts']],
        ['/project/src/lib.ts', []],
      ]),
      exported: [mkSymbol(1, '/project/src/lib.ts', 'unusedFn')],
      searchRelations: relationsOfType('imports', [mkImport('/project/src/consumer.ts', '/project/src/lib.ts', '*')]),
      pkgJson: {},
    });

    expect(result.deadExports.length).toBe(0);
  });

  it('should not treat side-effect import (null dstSymbolName) as usesAll', async () => {
    // import './lib' → dstSymbolName = null (side-effect) → does NOT mark usesAll → export is dead.
    const result = await analyzeWithExports({
      graph: new Map([
        ['/project/src/main.ts', ['/project/src/lib.ts']],
        ['/project/src/lib.ts', []],
      ]),
      exported: [mkSymbol(1, '/project/src/lib.ts', 'unusedFn')],
      searchRelations: relationsOfType('imports', [mkImport('/project/src/main.ts', '/project/src/lib.ts', null)]),
      pkgJson: { main: './src/main.ts' },
    });

    expect(result.deadExports.length).toBe(1);
    expect(result.deadExports[0]!.name).toBe('unusedFn');
  });

  it('should not flag symbol as dead when re-exported', async () => {
    const result = await analyzeWithExports({
      graph: new Map([
        ['/project/src/barrel.ts', ['/project/src/lib.ts']],
        ['/project/src/lib.ts', []],
      ]),
      exported: [mkSymbol(1, '/project/src/lib.ts', 'sharedFn')],
      searchRelations: relationsOfType('re-exports', [mkReExport('/project/src/barrel.ts', '/project/src/lib.ts', 'sharedFn')]),
      pkgJson: {},
    });

    expect(result.deadExports.length).toBe(0);
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
    expectFirstFanOut(result, 'a.ts', 2);
  });

  /* ---------- NE: Negative / Error ---------- */

  it('should return empty when getImportGraph returns Err', async () => {
    const g = createMockGildash({
      getImportGraph: async () => gildashThrow('graph failed'),
    });
    const result = await analyzeDependencies(g, { rootAbs: ROOT });

    expectEmptyDepsGraph(result);
  });

  it('should return empty cycles when getCyclePaths returns Err', async () => {
    const graph = new Map<string, string[]>([
      ['/project/a.ts', ['/project/b.ts']],
      ['/project/b.ts', ['/project/a.ts']],
    ]);
    const g = createMockGildash({
      getImportGraph: async () => graph,
      getCyclePaths: async () => gildashThrow('cycle detection failed'),
    });
    const result = await analyzeDependencies(g, { rootAbs: ROOT });

    expect(result.cycles.length).toBe(0);
    expect(Object.keys(result.adjacency).length).toBe(2);
  });

  it('should skip file exportStats when searchSymbols returns Err', async () => {
    const graph = new Map<string, string[]>([['/project/src/mod.ts', []]]);
    const g = createMockGildash({
      getImportGraph: async () => graph,
      searchSymbols: () => gildashThrow('search failed'),
    });
    const result = await analyzeDependencies(g, { rootAbs: ROOT });

    expect(Object.keys(result.exportStats).length).toBe(0);
  });

  it('should produce empty dead exports when searchRelations returns Err', async () => {
    const graph = new Map<string, string[]>([['/project/src/orphan.ts', []]]);
    const g = createMockGildash({
      getImportGraph: async () => graph,
      searchSymbols: searchExported([mkSymbol(1, '/project/src/orphan.ts', 'fn')]),
      searchRelations: () => gildashThrow('relations failed'),
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

    expectEmptyDepsGraph(result);
  });

  it('should handle readPackageEntrypoints failure gracefully', async () => {
    const graph = new Map<string, string[]>([['/project/src/orphan.ts', []]]);
    const g = createMockGildash({
      getImportGraph: async () => graph,
      searchSymbols: searchExported([mkSymbol(1, '/project/src/orphan.ts', 'fn')]),
      searchRelations: () => [],
    });
    const result = await analyzeDependencies(g, {
      rootAbs: ROOT,
      readFileFn: () => {
        throw new Error('read failed');
      },
    });

    // No entry points resolved → skip unused-file/dead-export analysis
    expect(result.unusedFiles.length).toBe(0);
    expectSingleDeadExport(result);
  });

  /* ---------- ED: Edge Cases ---------- */

  it('should handle single file with no imports', async () => {
    const graph = new Map<string, string[]>([['/project/src/lone.ts', []]]);
    const g = createMockGildash({ getImportGraph: async () => graph });
    const result = await analyzeDependencies(g, { rootAbs: ROOT });

    expect(result.adjacency['src/lone.ts']).toEqual([]);
    expectNoFanInOut(result);
  });

  it('should handle self-importing file as self-loop cycle', async () => {
    const graph = new Map<string, string[]>([['/project/a.ts', ['/project/a.ts']]]);
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

    expectNoFanInOut(result);
  });

  it('should handle rootAbs normalization with backslashes', async () => {
    const g = makeAbGraphGildash();
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
      getCyclePaths: async () => gildashThrow('cycle error'),
      searchSymbols: () => gildashThrow('search error'),
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
      getCyclePaths: async () => [['/project/src/ui/comp.ts', '/project/src/domain/svc.ts', '/project/src/ui/comp.ts']],
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
      ['/project/src/main.ts', ['/project/src/lib.ts']],
      ['/project/src/lib.ts', []],
      ['/project/test/lib.spec.ts', ['/project/src/lib.ts']],
    ]);
    const exported = [mkSymbol(1, '/project/src/lib.ts', 'deadFn'), mkSymbol(2, '/project/src/lib.ts', 'testOnlyFn')];
    const g = createMockGildash({
      getImportGraph: async () => graph,
      searchSymbols: (q: unknown) => {
        if ((q as { isExported?: boolean }).isExported) {
          return exported;
        }

        return [];
      },
      searchRelations: (q: unknown) => {
        if ((q as { type?: string }).type === 'imports') {
          return [mkImport('/project/test/lib.spec.ts', '/project/src/lib.ts', 'testOnlyFn')];
        }

        return [];
      },
    });
    const result = await analyzeDependencies(g, {
      rootAbs: ROOT,
      readFileFn: () => JSON.stringify({ main: './src/main.ts' }),
    });
    const dead = result.deadExports.filter(d => d.kind === 'dead-export');
    const testOnly = result.deadExports.filter(d => d.kind === 'test-only-export');

    expectSingleNamed(dead, 'deadFn');
    expectSingleNamed(testOnly, 'testOnlyFn');
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

  /* ---------- UF: Unused Files + EP: Entry point edge cases ---------- */

  const unusedFilesCases: UnusedFilesCase[] = [
    {
      name: 'reports unreachable non-test file as unused-file',
      graph: new Map([
        ['/project/src/index.ts', ['/project/src/used.ts']],
        ['/project/src/used.ts', []],
        ['/project/src/orphan.ts', []],
      ]),
      main: './src/index.ts',
      expectedUnusedFileModules: ['src/orphan.ts'],
    },
    {
      name: 'excludes test files from unused-file findings',
      graph: new Map([
        ['/project/src/index.ts', []],
        ['/project/test/foo.spec.ts', []],
      ]),
      main: './src/index.ts',
      expectedUnusedFileModules: [],
    },
    {
      name: 'skips unused-file detection when package.json main points to non-existent file',
      graph: new Map([
        ['/project/src/real.ts', []],
        ['/project/src/orphan.ts', []],
      ]),
      main: './src/nonexistent.ts',
      expectedUnusedFileModules: [],
    },
    {
      name: 'returns empty unusedFiles when all files are reachable',
      graph: new Map([
        ['/project/src/index.ts', ['/project/src/a.ts', '/project/src/b.ts']],
        ['/project/src/a.ts', []],
        ['/project/src/b.ts', []],
      ]),
      main: './src/index.ts',
      expectedUnusedFileModules: [],
    },
  ];

  it.each(unusedFilesCases)('$name', async ({ graph, main, expectedUnusedFileModules }) => {
    const g = createMockGildash({
      getImportGraph: async () => graph,
      searchSymbols: () => [],
      searchRelations: () => [],
    });
    const result = await analyzeDependencies(g, { rootAbs: ROOT, readFileFn: () => JSON.stringify({ main }) });
    const actual = result.unusedFiles.map(f => f.module);

    expect(actual).toEqual([...expectedUnusedFileModules]);
  });

  /* ---------- UD/UR/IG/SR/PD: external + unresolved import classification ---------- */

  const importCases: ImportClassificationCase[] = [
    {
      name: 'detects unused dependency declared in package.json',
      imports: [mkImport('/project/src/index.ts', null, null, { isExternal: true, specifier: 'lodash' })],
      pkgJson: { main: './src/index.ts', dependencies: { lodash: '^4.0.0', unused: '^1.0.0' } },
      expectedUnusedDeps: [{ kind: 'unused-dependency', packageName: 'unused' }],
      expectedUnresolved: [],
    },
    {
      name: 'detects unlisted dependency not in package.json',
      imports: [mkImport('/project/src/index.ts', null, null, { isExternal: true, specifier: 'unlisted-pkg' })],
      pkgJson: { main: './src/index.ts', dependencies: {} },
      expectedUnusedDeps: [{ kind: 'unlisted-dependency', packageName: 'unlisted-pkg' }],
      expectedUnresolved: [],
    },
    {
      name: 'skips @types/* when corresponding package is used',
      imports: [mkImport('/project/src/index.ts', null, null, { isExternal: true, specifier: 'express' })],
      pkgJson: {
        main: './src/index.ts',
        dependencies: { express: '^4.0.0' },
        devDependencies: { '@types/express': '^4.0.0' },
      },
      expectedUnusedDeps: [],
      expectedUnresolved: [],
    },
    {
      name: 'skips node: and bun: builtin modules',
      imports: [
        mkImport('/project/src/index.ts', null, null, { isExternal: true, specifier: 'node:fs' }),
        mkImport('/project/src/index.ts', null, null, { isExternal: true, specifier: 'bun:test' }),
      ],
      pkgJson: { main: './src/index.ts', dependencies: {} },
      expectedUnusedDeps: [],
      expectedUnresolved: [],
    },
    {
      name: 'handles scoped package names in specifiers',
      imports: [mkImport('/project/src/index.ts', null, null, { isExternal: true, specifier: '@scope/pkg/sub' })],
      pkgJson: { main: './src/index.ts', dependencies: { '@scope/pkg': '^1.0.0' } },
      expectedUnusedDeps: [],
      expectedUnresolved: [],
    },
    {
      name: 'detects unresolved non-relative internal import',
      imports: [mkImport('/project/src/index.ts', null, null, { isExternal: false, specifier: '#config/missing' })],
      pkgJson: { main: './src/index.ts' },
      expectedUnusedDeps: [],
      expectedUnresolved: [{ specifier: '#config/missing', module: 'src/index.ts' }],
    },
    {
      name: 'reports relative path unresolved import (gildash 0.17.2 resolves dotted filenames)',
      imports: [mkImport('/project/src/index.ts', null, null, { isExternal: false, specifier: './missing-module' })],
      pkgJson: { main: './src/index.ts' },
      expectedUnusedDeps: [],
      expectedUnresolved: [{ specifier: './missing-module', module: 'src/index.ts' }],
    },
    {
      name: 'respects ignoreDependencies glob patterns',
      imports: [],
      pkgJson: { main: './src/index.ts', dependencies: { 'eslint-plugin-foo': '^1.0.0' } },
      ignoreDependencies: ['eslint-*'],
      expectedUnusedDeps: [],
      expectedUnresolved: [],
    },
    {
      name: 'does not report self-referencing import as unlisted-dependency',
      imports: [mkImport('/project/src/index.ts', null, null, { isExternal: true, specifier: 'my-package' })],
      pkgJson: { name: 'my-package', main: './src/index.ts', dependencies: {} },
      expectedUnusedDeps: [],
      expectedUnresolved: [],
    },
    {
      name: 'does not treat peerDependencies / optionalDependencies as declared deps',
      imports: [],
      pkgJson: {
        main: './src/index.ts',
        peerDependencies: { react: '^18.0.0' },
        optionalDependencies: { fsevents: '^2.0.0' },
      },
      expectedUnusedDeps: [],
      expectedUnresolved: [],
    },
    {
      name: 'returns empty unusedDeps when all declared deps are used',
      imports: [
        mkImport('/project/src/index.ts', null, null, { isExternal: true, specifier: 'lodash' }),
        mkImport('/project/src/index.ts', null, null, { isExternal: true, specifier: '@scope/pkg' }),
      ],
      pkgJson: { main: './src/index.ts', dependencies: { lodash: '^4.0.0', '@scope/pkg': '^1.0.0' } },
      expectedUnusedDeps: [],
      expectedUnresolved: [],
    },
  ];

  it.each(importCases)('$name', async ({ imports, pkgJson, ignoreDependencies, expectedUnusedDeps, expectedUnresolved }) => {
    const result = await analyzeImports(imports, pkgJson, ignoreDependencies);
    const actualUnusedDeps = result.unusedDeps.map(d => ({ kind: d.kind, packageName: d.packageName }));
    const actualUnresolved = result.unresolvedImports.map(u => ({ specifier: u.specifier, module: u.module }));

    expect(actualUnusedDeps).toEqual([...expectedUnusedDeps]);
    expect(actualUnresolved).toEqual([...expectedUnresolved]);
  });

  /* ---------- DE: Duplicate Exports ---------- */

  it('should detect duplicate exports pointing to same origin via resolveSymbol', async () => {
    // Both a.ts and b.ts re-export 'helper' from the same original source (src/origin.ts).
    const result = await analyzeWithExports({
      graph: new Map([['/project/src/index.ts', []]]),
      exported: [
        mkSymbol(1, '/project/src/a.ts', 'helper', 'function'),
        mkSymbol(2, '/project/src/b.ts', 'helper', 'function'),
        mkSymbol(3, '/project/src/c.ts', 'unique', 'function'),
      ],
      resolveSymbol: resolveSymbolToOrigin('helper', 'src/origin.ts'),
    });

    expect(result.duplicateExports.length).toBe(1);
    expect(result.duplicateExports[0]!.name).toBe('helper');
    expect(result.duplicateExports[0]!.modules).toEqual(['src/a.ts', 'src/b.ts']);
  });

  // Default mock resolveSymbol: each symbol resolves to itself → distinct origins → never a duplicate,
  // whether the two exported names collide ('helper'/'helper') or differ ('foo'/'bar').
  const noDuplicateExportCases: NoDuplicateExportCase[] = [
    {
      name: 'does not report duplicate exports with same name but different origins',
      exported: [mkSymbol(1, '/project/src/a.ts', 'helper', 'function'), mkSymbol(2, '/project/src/b.ts', 'helper', 'function')],
    },
    {
      name: 'returns empty duplicateExports when no name collision exists',
      exported: [mkSymbol(1, '/project/src/a.ts', 'foo', 'function'), mkSymbol(2, '/project/src/b.ts', 'bar', 'function')],
    },
  ];

  it.each(noDuplicateExportCases)('$name', async ({ exported }) => {
    const result = await analyzeWithExports({ graph: new Map([['/project/src/index.ts', []]]), exported });

    expect(result.duplicateExports.length).toBe(0);
  });

  it('should include symbolKind in dead export findings', async () => {
    const result = await analyzeWithExports({
      graph: new Map([['/project/src/index.ts', ['/project/src/lib.ts']]]),
      exported: [mkSymbol(1, '/project/src/lib.ts', 'MyType', 'type'), mkSymbol(2, '/project/src/lib.ts', 'MyEnum', 'enum')],
      pkgJson: { main: './src/index.ts' },
    });

    expect(result.deadExports.length).toBe(2);
    expect(result.deadExports[0]!.symbolKind).toBe('type');
    expect(result.deadExports[1]!.symbolKind).toBe('enum');
  });

  /* ---------- NS: Namespace import ---------- */

  it('should not report dead exports for namespace-imported modules', async () => {
    // Namespace import marks module as usesAll → no dead exports.
    const result = await analyzeWithExports({
      graph: new Map([
        ['/project/src/index.ts', ['/project/src/utils.ts']],
        ['/project/src/utils.ts', []],
      ]),
      exported: [
        mkSymbol(1, '/project/src/utils.ts', 'foo', 'function'),
        mkSymbol(2, '/project/src/utils.ts', 'bar', 'function'),
      ],
      searchRelations: relationsOfType('imports', [
        mkImport('/project/src/index.ts', '/project/src/utils.ts', '*', { specifier: './utils', srcSymbolName: 'Utils' }),
      ]),
      pkgJson: { main: './src/index.ts' },
    });

    expect(result.deadExports.length).toBe(0);
  });

  /* ---------- WS: Workspace support ---------- */

  it('should analyze unused deps per workspace when workspacePackages provided', async () => {
    const graph = new Map<string, string[]>([['/project/packages/ws1/src/index.ts', []]]);
    const g = createMockGildash({
      getImportGraph: async () => graph,
      searchSymbols: () => [],
      searchRelations: (q: unknown) => {
        if ((q as { type?: string }).type === 'imports') {
          return [mkImport('/project/packages/ws1/src/index.ts', null, null, { isExternal: true, specifier: 'lodash' })];
        }

        return [];
      },
    });
    const result = await analyzeDependencies(g, {
      rootAbs: ROOT,
      readFileFn: (p: string) => {
        if (p.includes('ws1')) {
          return JSON.stringify({ name: 'ws1', dependencies: {} });
        }

        return JSON.stringify({});
      },
      workspacePackages: new Map([['ws1', '/project/packages/ws1']]),
    });

    expect(result.unusedDeps.length).toBe(1);
    expect(result.unusedDeps[0]!.kind).toBe('unlisted-dependency');
    expect(result.unusedDeps[0]!.packageName).toBe('lodash');
  });

  /* ---------- UM: Unused Enum / Namespace Members ---------- */

  const memberCases: MemberDetectionCase[] = [
    {
      name: 'detects unused enum members via getSymbolsByFile + calls (Color.Red used, Green/Blue not)',
      container: mkSymbol(1, '/project/src/colors.ts', 'Color', 'enum'),
      containerFile: '/project/src/colors.ts',
      importName: 'Color',
      calledMembers: ['Color.Red'],
      members: [
        { kind: 'enum', name: 'Color', memberName: null, isExported: true },
        { kind: 'property', name: 'Color.Red', memberName: 'Red', isExported: false },
        { kind: 'property', name: 'Color.Green', memberName: 'Green', isExported: false },
        { kind: 'property', name: 'Color.Blue', memberName: 'Blue', isExported: false },
      ],
      expectedKind: 'unused-enum-member',
      expectedUnusedMemberNames: ['Blue', 'Green'],
    },
    {
      name: 'detects unused namespace members via getSymbolsByFile + calls (Guards.isString used, isNumber not)',
      container: mkSymbol(1, '/project/src/guards.ts', 'Guards', 'namespace'),
      containerFile: '/project/src/guards.ts',
      importName: 'Guards',
      calledMembers: ['Guards.isString'],
      members: [
        { kind: 'namespace', name: 'Guards', memberName: null, isExported: true },
        { kind: 'function', name: 'Guards.isString', memberName: 'isString', isExported: false },
        { kind: 'function', name: 'Guards.isNumber', memberName: 'isNumber', isExported: false },
      ],
      expectedKind: 'unused-ns-member',
      expectedUnusedMemberNames: ['isNumber'],
    },
  ];

  it.each(memberCases)(
    '$name',
    async ({ container, containerFile, importName, calledMembers, members, expectedKind, expectedUnusedMemberNames }) => {
      const result = await analyzeMembers({ container, containerFile, importName, calledMembers, members });
      const found = result.unusedMembers.filter(m => m.kind === expectedKind);

      expect(found.map(m => m.memberName).sort()).toEqual([...expectedUnusedMemberNames]);
      expect([...new Set(found.map(m => m.symbolName))]).toEqual([container.name]);
    },
  );

  it('should skip all enum members when parent enum is imported with usesAll', async () => {
    // `import * as Color` → usesAll → every member treated as used regardless of calls.
    const result = await analyzeMembers({
      container: mkSymbol(1, '/project/src/colors.ts', 'Color', 'enum'),
      containerFile: '/project/src/colors.ts',
      importName: '*',
      calledMembers: [],
      members: [
        { kind: 'enum', name: 'Color', memberName: null, isExported: true },
        { kind: 'property', name: 'Color.Red', memberName: 'Red', isExported: false },
      ],
    });

    expect(result.unusedMembers.length).toBe(0);
  });

  /* ---------- RS: resolveSymbol fallback ---------- */

  it('should use fallback origin when resolveSymbol throws for duplicate candidates', async () => {
    // resolveSymbol throws → each module treated as its own origin → no duplicates.
    const result = await analyzeWithExports({
      graph: new Map([['/project/src/index.ts', []]]),
      exported: [mkSymbol(1, '/project/src/a.ts', 'util', 'function'), mkSymbol(2, '/project/src/b.ts', 'util', 'function')],
      resolveSymbol: () => {
        throw new Error('resolveSymbol failed');
      },
    });

    expect(result.duplicateExports.length).toBe(0);
  });

  /* ---------- EM: Enum member — parent import skip ---------- */

  /* ---------- RE: re-export usesAll ---------- */

  it('should treat re-export with null dstSymbolName as usesAll', async () => {
    // export * from './lib' → re-export with null dstSymbolName → usesAll → no dead exports.
    const result = await analyzeWithExports({
      graph: new Map([
        ['/project/src/index.ts', ['/project/src/lib.ts']],
        ['/project/src/lib.ts', []],
      ]),
      exported: [mkSymbol(1, '/project/src/lib.ts', 'fn', 'function')],
      searchRelations: relationsOfType('re-exports', [mkReExport('/project/src/index.ts', '/project/src/lib.ts', null)]),
      pkgJson: { main: './src/index.ts' },
    });

    expect(result.deadExports.length).toBe(0);
  });

  /* ---------- RX: Re-export dead detection ---------- */

  it('should collect re-exports from re-exports relation and detect dead ones', async () => {
    // index.ts re-exports both, but only usedFn is consumed externally → deadFn re-export is dead.
    const result = await analyzeWithExports({
      graph: new Map([
        ['/project/src/index.ts', ['/project/src/lib.ts']],
        ['/project/src/lib.ts', []],
      ]),
      exported: [
        mkSymbol(1, '/project/src/lib.ts', 'usedFn', 'function'),
        mkSymbol(2, '/project/src/lib.ts', 'deadFn', 'function'),
      ],
      searchRelations: relationsByType({
        're-exports': [
          mkReExport('/project/src/index.ts', '/project/src/lib.ts', 'usedFn', 'usedFn'),
          mkReExport('/project/src/index.ts', '/project/src/lib.ts', 'deadFn', 'deadFn'),
        ],
        imports: [mkImport('/project/src/consumer.ts', '/project/src/index.ts', 'usedFn')],
      }),
      pkgJson: { main: './src/index.ts' },
    });

    expectSingleNamed(indexDeadExports(result), 'deadFn');
  });

  it('should collect type re-exports via meta.isReExport and detect dead ones', async () => {
    // types.ts does `export type { MyConfig } from './shared/config'` but nobody imports it via types.ts → dead.
    const result = await analyzeWithExports({
      graph: new Map([
        ['/project/src/types.ts', ['/project/src/shared/config.ts']],
        ['/project/src/shared/config.ts', []],
      ]),
      exported: [mkSymbol(1, '/project/src/shared/config.ts', 'MyConfig', 'type')],
      searchRelations: relationsOfType('type-references', [
        mkTypeRef('/project/src/types.ts', '/project/src/shared/config.ts', 'MyConfig', true),
      ]),
      pkgJson: { main: './src/types.ts' },
    });
    const deadReExports = result.deadExports.filter(d => d.module === 'src/types.ts');

    expect(deadReExports.length).toBe(1);
    expect(deadReExports[0]!.name).toBe('MyConfig');
  });

  it('should propagate dead through re-export chain — original also dead when only consumer is dead re-export', async () => {
    // index.ts re-exports orphanFn but nobody imports from index.ts → both index.ts re-export and lib.ts original are dead.
    const result = await analyzeWithExports({
      graph: new Map([
        ['/project/src/index.ts', ['/project/src/lib.ts']],
        ['/project/src/lib.ts', []],
      ]),
      exported: [mkSymbol(1, '/project/src/lib.ts', 'orphanFn', 'function')],
      searchRelations: relationsOfType('re-exports', [
        mkReExport('/project/src/index.ts', '/project/src/lib.ts', 'orphanFn', 'orphanFn'),
      ]),
      pkgJson: { main: './src/index.ts' },
    });
    const libDead = result.deadExports.filter(d => d.module === 'src/lib.ts');

    expectSingleNamed(indexDeadExports(result), 'orphanFn');
    expectSingleNamed(libDead, 'orphanFn');
  });

  /* ---------- DG: Relation degrade → dead-family verdicts held (B1) ---------- */

  // When `imports` indexes successfully but one of the completeness relations
  // (re-exports / type-references / calls) throws GildashError, the "usage = 0"
  // family (dead-export / test-only-export / unused-member) must be HELD to avoid
  // FPs from missing edges — while imports-only findings (unresolved / dep manifest)
  // still proceed.
  const degradedRelationTypes: ReadonlyArray<[string]> = [['re-exports'], ['type-references'], ['calls']];

  it.each(degradedRelationTypes)('should hold dead-export verdict when %s relation degrades', async relType => {
    const g = createMockGildash({
      getImportGraph: async () =>
        new Map<string, string[]>([
          ['/project/src/main.ts', ['/project/src/orphan.ts']],
          ['/project/src/orphan.ts', []],
        ]),
      searchSymbols: exportedSymbols([mkSymbol(1, '/project/src/orphan.ts', 'unusedFn')]),
      searchRelations: (q: unknown) => {
        const type = (q as { type?: string }).type;

        if (type === relType) {
          return gildashThrow(`${relType} relation failed`);
        }

        // imports (and the other complete relations) succeed with no edges.
        return [];
      },
    });
    const result = await analyzeDependencies(g, { rootAbs: ROOT, readFileFn: () => JSON.stringify({ main: './src/main.ts' }) });

    // dead-export held (would otherwise report orphan.ts::unusedFn).
    expect(result.deadExports.length).toBe(0);
  });

  it('should still report unresolved import when a completeness relation degrades', async () => {
    // imports succeeds (carrying an unresolved internal import); calls degrades.
    // Manifest/resolution findings do not depend on relation completeness → proceed.
    const g = createMockGildash({
      getImportGraph: async () => new Map<string, string[]>([['/project/src/index.ts', []]]),
      searchSymbols: () => [],
      searchRelations: (q: unknown) => {
        const type = (q as { type?: string }).type;

        if (type === 'imports') {
          return [mkImport('/project/src/index.ts', null, null, { isExternal: false, specifier: './missing' })];
        }

        if (type === 'calls') {
          return gildashThrow('calls relation failed');
        }

        return [];
      },
    });
    const result = await analyzeDependencies(g, { rootAbs: ROOT, readFileFn: () => JSON.stringify({ main: './src/index.ts' }) });

    expectSingleMissingUnresolved(result);
  });

  /* ---------- CF: Cross-file qualified member attribution (B2) ---------- */

  it('should attribute a cross-file qualified member call via named import (used member not flagged)', async () => {
    // guards.ts defines namespace Guards { isString, isNumber }. consumer.ts imports
    // { Guards } and calls Guards.isNumber(); that call is recorded on consumer.ts.
    // It must be attributed back to guards.ts so isNumber is NOT flagged; only the
    // truly-uncalled isString remains W.
    const guardsFile = '/project/src/guards.ts';
    const graph = new Map<string, string[]>([
      ['/project/src/index.ts', ['/project/src/consumer.ts', guardsFile]],
      ['/project/src/consumer.ts', [guardsFile]],
      [guardsFile, []],
    ]);
    const g = createMockGildash({
      getImportGraph: async () => graph,
      searchSymbols: exportedSymbols([mkSymbol(1, guardsFile, 'Guards', 'namespace')]),
      searchRelations: (q: unknown) => {
        const type = (q as { type?: string }).type;

        if (type === 'imports') {
          return [
            mkImport('/project/src/consumer.ts', guardsFile, 'Guards'),
            mkImport('/project/src/index.ts', guardsFile, 'Guards'),
          ];
        }

        if (type === 'calls') {
          // Qualified call recorded on the CONSUMER file, not on guards.ts.
          return [mkCall('/project/src/consumer.ts', '/project/src/consumer.ts', 'Guards.isNumber')];
        }

        return [];
      },
      getSymbolsByFile: guardsFileSymbols,
    });
    const result = await analyzeDependencies(g, { rootAbs: ROOT, readFileFn: () => JSON.stringify({ main: './src/index.ts' }) });
    const unused = result.unusedMembers.filter(m => m.kind === 'unused-ns-member');

    expect(unused.map(m => m.memberName)).toEqual(['isString']);
  });

  it('should hold the parent member verdict when a qualified call cannot be attributed to the parent module', async () => {
    // consumer.ts calls Guards.isNumber() but did NOT import Guards from guards.ts
    // (no attributing import edge). Attribution is not closed → the whole parent's
    // member verdict is held (conservative K) — isNumber must NOT be flagged.
    const guardsFile = '/project/src/guards.ts';
    const graph = new Map<string, string[]>([
      ['/project/src/index.ts', [guardsFile]],
      ['/project/src/consumer.ts', []],
      [guardsFile, []],
    ]);
    const g = createMockGildash({
      getImportGraph: async () => graph,
      searchSymbols: exportedSymbols([mkSymbol(1, guardsFile, 'Guards', 'namespace')]),
      searchRelations: (q: unknown) => {
        const type = (q as { type?: string }).type;

        if (type === 'imports') {
          return [mkImport('/project/src/index.ts', guardsFile, 'Guards')];
        }

        if (type === 'calls') {
          return [mkCall('/project/src/consumer.ts', '/project/src/consumer.ts', 'Guards.isNumber')];
        }

        return [];
      },
      getSymbolsByFile: guardsFileSymbols,
    });
    const result = await analyzeDependencies(g, { rootAbs: ROOT, readFileFn: () => JSON.stringify({ main: './src/index.ts' }) });

    expect(result.unusedMembers.length).toBe(0);
  });

  /* ---------- PO: peer / optional declared → not unlisted (B4) ---------- */

  it('should not flag peer/optionalDependencies as unlisted when imported', async () => {
    const result = await analyzeImports(
      [
        mkImport('/project/src/index.ts', null, null, { isExternal: true, specifier: 'react' }),
        mkImport('/project/src/index.ts', null, null, { isExternal: true, specifier: 'fsevents' }),
      ],
      {
        main: './src/index.ts',
        peerDependencies: { react: '^18.0.0' },
        optionalDependencies: { fsevents: '^2.0.0' },
      },
    );

    expect(result.unusedDeps.filter(d => d.kind === 'unlisted-dependency').length).toBe(0);
  });

  /* ---------- UX: unresolved re-export (B3) ---------- */

  it('should report an unresolved re-export (export … from missing module) as unresolved-import', async () => {
    const g = createMockGildash({
      getImportGraph: async () => new Map<string, string[]>([['/project/src/barrel.ts', []]]),
      searchSymbols: () => [],
      searchRelations: (q: unknown) => {
        const type = (q as { type?: string }).type;

        if (type === 'imports') {
          return [];
        }

        if (type === 're-exports') {
          // export { lost } from './missing' → dstFilePath null, specifier present.
          return [{ ...mkReExport('/project/src/barrel.ts', '', 'lost', 'lost'), dstFilePath: null, specifier: './missing' }];
        }

        return [];
      },
    });
    const result = await analyzeDependencies(g, { rootAbs: ROOT, readFileFn: () => JSON.stringify({ main: './src/barrel.ts' }) });

    expectSingleMissingUnresolved(result);
    expect(result.unresolvedImports[0]!.module).toBe('src/barrel.ts');
  });
});
