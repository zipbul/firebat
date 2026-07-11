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
  extra: { isExternal?: boolean; specifier?: string | null; srcSymbolName?: string | null; meta?: Record<string, unknown> } = {},
): StoredCodeRelation => ({
  type: 'imports',
  srcFilePath,
  srcSymbolName: extra.srcSymbolName ?? null,
  dstFilePath,
  dstSymbolName,
  dstProject: null,
  isExternal: extra.isExternal ?? false,
  specifier: extra.specifier ?? null,
  ...(extra.meta !== undefined ? { meta: extra.meta } : {}),
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
  /** User-declared `entry` globs. unused-file is opt-in — absent → HOLD. */
  entry?: ReadonlyArray<string>;
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

const ROW_SPAN = { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } };

interface MemberSymbolRow {
  kind: string;
  name: string;
  memberName: string | null;
  isExported: boolean;
  span: { start: { line: number; column: number }; end: { line: number; column: number } };
}

/**
 * `getSymbolsByFile` mock for the cross-file member-attribution tests: returns a
 * `Guards` namespace with `isString` / `isNumber` members for `src/guards.ts`,
 * and `[]` for every other file. Shared by the two B2 attribution cases.
 */
const guardsFileSymbols = (filePath: string): ReadonlyArray<MemberSymbolRow> =>
  filePath === 'src/guards.ts'
    ? [
        { kind: 'namespace', name: 'Guards', memberName: null, isExported: true, span: ROW_SPAN },
        { kind: 'function', name: 'Guards.isString', memberName: 'isString', isExported: false, span: ROW_SPAN },
        { kind: 'function', name: 'Guards.isNumber', memberName: 'isNumber', isExported: false, span: ROW_SPAN },
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

/** Path-accurate manifest mock: answers only the ROOT package.json, throws otherwise (real-FS semantics). */
const rootOnlyRead =
  (pkg: unknown) =>
  (p: string): string => {
    if (p === `${ROOT}/package.json`) {
      return JSON.stringify(pkg);
    }

    // Model an installed project: every dep manifest is readable with no `bin` (a pure library),
    // so unused-dependency resolves to a definite 'no-bin' verdict rather than 'unknown' (hold).
    // Tests that need a bin-providing dep use the dedicated readWithBins helper below.
    if (/\/node_modules\/(@[^/]+\/)?[^/]+\/package\.json$/.test(p)) {
      return '{}';
    }

    throw new Error(`ENOENT: ${p}`);
  };

  /**
   * Mock gildash with a fixed import graph, no symbols, and whose only relations are
   * the given `imports` — the shared arrange shape of every dependency-declaration test
   * (unused/unlisted-dep, bin-state, hoist, unknown-hold).
   */
  const importsGildash = (graph: Map<string, string[]>, imports: ReadonlyArray<StoredCodeRelation> = []): Gildash =>
    createMockGildash({
      getImportGraph: async () => graph,
      searchSymbols: () => [],
      searchRelations: (q: unknown) => ((q as { type?: string }).type === 'imports' ? [...imports] : []),
    });

  /** Project each unused-dep finding to its comparable core (kind + packageName). */
  const toKindName = (r: Awaited<ReturnType<typeof analyzeDependencies>>): Array<{ kind: string; packageName: string }> =>
    r.unusedDeps.map(d => ({ kind: d.kind, packageName: d.packageName }));

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
    const g = importsGildash(new Map<string, string[]>([['/project/src/index.ts', []]]), imports);

    return analyzeDependencies(g, { rootAbs: ROOT, readFileFn: rootOnlyRead(pkgJson), ignoreDependencies });
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

    return analyzeDependencies(g, { rootAbs: ROOT, readFileFn: rootOnlyRead({ main: './src/index.ts' }) });
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
    entry?: ReadonlyArray<string>;
    ignore?: ReadonlyArray<string>;
  }): Promise<Awaited<ReturnType<typeof analyzeDependencies>>> => {
    const g = createMockGildash({
      getImportGraph: async () => params.graph,
      searchSymbols: exportedSymbols(params.exported),
      searchRelations: params.searchRelations ?? (() => []),
      ...(params.resolveSymbol === undefined ? {} : { resolveSymbol: params.resolveSymbol }),
    });

    return analyzeDependencies(g, {
      rootAbs: ROOT,
      ...(params.pkgJson === undefined ? {} : { readFileFn: rootOnlyRead(params.pkgJson) }),
      ...(params.entry === undefined ? {} : { entry: params.entry }),
      ...(params.ignore === undefined ? {} : { ignore: params.ignore }),
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
      entry: ['**/main.ts'], // unused-file is opt-in: the user declares the entry set
    });

    expect(result.unusedFiles.length).toBe(1);
    expect(result.unusedFiles[0]!.module).toBe('src/orphan.ts');
    expect(result.deadExports.length).toBe(0);
  });

  it('should HOLD unused-file entirely when the user declared no `entry` (opt-in)', async () => {
    const result = await analyzeWithExports({
      graph: new Map([
        ['/project/src/main.ts', []],
        ['/project/src/orphan.ts', []],
      ]),
      exported: [],
      pkgJson: { main: './src/main.ts' },
      // no `entry` → completeness of the root set is unproven → hold, never flood.
    });

    expect(result.unusedFiles.length).toBe(0);
  });

  it('should NOT leak an unreachable orphan file as dead-export when no `entry` is declared', async () => {
    const result = await analyzeWithExports({
      graph: new Map([
        ['/project/src/main.ts', []],
        ['/project/src/orphan.ts', []],
      ]),
      exported: [mkSymbol(1, '/project/src/orphan.ts', 'unusedFn')],
      pkgJson: { main: './src/main.ts' },
      // no `entry`: orphan is unreachable from package.json `main` (dedup guard), so its
      // exports must NOT surface as dead-export, and unused-file is held. Both silent.
    });

    expect(result.unusedFiles.length).toBe(0);
    expect(result.deadExports.length).toBe(0);
  });

  it('should treat a file matched by a user `entry` glob as reachable (not unused-file)', async () => {
    const result = await analyzeWithExports({
      graph: new Map([
        ['/project/src/main.ts', []],
        ['/project/src/orphan.ts', []],
      ]),
      exported: [],
      pkgJson: { main: './src/main.ts' },
      entry: ['**/orphan.ts'],
    });

    // orphan is unreachable from package.json `main`, but the user declared it an entry.
    expect(result.unusedFiles.length).toBe(0);
  });

  it('should exclude a file matched by a user `ignore` glob from unused-file', async () => {
    const result = await analyzeWithExports({
      graph: new Map([
        ['/project/src/main.ts', []],
        ['/project/src/orphan.ts', []],
      ]),
      exported: [],
      pkgJson: { main: './src/main.ts' },
      entry: ['**/main.ts'], // opt-in so unused-file is active; orphan is unreachable
      ignore: ['**/orphan.ts'], // …but the user declared it is not an orphan → suppressed
    });

    expect(result.unusedFiles.length).toBe(0);
  });

  it('should not report an export consumed only by a test file as dead (a consumer keeps it live)', async () => {
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

    // A test-file consumer is still a consumer — helperFn has one, so it is not dead.
    // Whether that consumer "counts as production" is not decidable from a filename fact,
    // so no test-only refinement is made (that would require a guess-value).
    expect(result.deadExports.length).toBe(0);
  });

  it('should not report dead export for symbols that are actually imported', async () => {
    const result = await analyzeWithExports({
      graph: new Map([
        ['/project/src/consumer.ts', ['/project/src/index.ts']],
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
    const result = await analyzeDependencies(g, { rootAbs: ROOT, readFileFn: rootOnlyRead({}) });
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
      readFileFn: rootOnlyRead({}),
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

  it('should report a dead export while an export consumed by a test file stays live', async () => {
    const graph = new Map<string, string[]>([
      ['/project/src/main.ts', ['/project/src/lib.ts']],
      ['/project/src/lib.ts', []],
      ['/project/test/lib.spec.ts', ['/project/src/lib.ts']],
    ]);
    const exported = [mkSymbol(1, '/project/src/lib.ts', 'deadFn'), mkSymbol(2, '/project/src/lib.ts', 'consumedByTestFn')];
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
          return [mkImport('/project/test/lib.spec.ts', '/project/src/lib.ts', 'consumedByTestFn')];
        }

        return [];
      },
    });
    const result = await analyzeDependencies(g, {
      rootAbs: ROOT,
      readFileFn: rootOnlyRead({ main: './src/main.ts' }),
    });
    const dead = result.deadExports.filter(d => d.kind === 'dead-export');

    // deadFn has no consumer → dead-export. consumedByTestFn has a (test-file) consumer →
    // it is not dead; a filename does not decide whether a consumer counts as production.
    expectSingleNamed(dead, 'deadFn');
    expect(result.deadExports.some(d => d.name === 'consumedByTestFn')).toBe(false);
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
      name: 'reports unreachable non-test file as unused-file (entry declared)',
      graph: new Map([
        ['/project/src/index.ts', ['/project/src/used.ts']],
        ['/project/src/used.ts', []],
        ['/project/src/orphan.ts', []],
      ]),
      main: './src/index.ts',
      entry: ['**/index.ts'],
      expectedUnusedFileModules: ['src/orphan.ts'],
    },
    {
      name: 'a test file listed in `entry` is a reachability root (not unused-file)',
      graph: new Map([
        ['/project/src/index.ts', []],
        ['/project/test/foo.spec.ts', []],
      ]),
      main: './src/index.ts',
      entry: ['**/index.ts', 'test/**'],
      expectedUnusedFileModules: [],
    },
    {
      name: 'HOLDs unused-file when no `entry` is declared (opt-in)',
      graph: new Map([
        ['/project/src/real.ts', []],
        ['/project/src/orphan.ts', []],
      ]),
      main: './src/nonexistent.ts',
      expectedUnusedFileModules: [],
    },
    {
      name: 'returns empty unusedFiles when all files are reachable (entry declared)',
      graph: new Map([
        ['/project/src/index.ts', ['/project/src/a.ts', '/project/src/b.ts']],
        ['/project/src/a.ts', []],
        ['/project/src/b.ts', []],
      ]),
      main: './src/index.ts',
      entry: ['**/index.ts'],
      expectedUnusedFileModules: [],
    },
  ];

  it.each(unusedFilesCases)('$name', async ({ graph, main, entry, expectedUnusedFileModules }) => {
    const g = createMockGildash({
      getImportGraph: async () => graph,
      searchSymbols: () => [],
      searchRelations: () => [],
    });
    const result = await analyzeDependencies(g, {
      rootAbs: ROOT,
      readFileFn: rootOnlyRead({ main }),
      ...(entry === undefined ? {} : { entry }),
    });
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
    {
      // @types/* deadness is not closable without merging tsconfig (extends/references/
      // triple-slash /// <reference types>), which a single leaf manifest cannot prove →
      // hold every @types/* (FN). Old code false-W'd @types/node (isBuiltinModule('node')
      // is false), @types/lodash (base not imported), and @types/jest (ambient globals).
      name: 'holds every @types/* unconditionally (deadness unclosable)',
      imports: [],
      pkgJson: {
        main: './src/index.ts',
        devDependencies: { '@types/lodash': '^4.0.0', '@types/node': '^20.0.0', '@types/jest': '^29.0.0' },
      },
      expectedUnusedDeps: [],
      expectedUnresolved: [],
    },
    {
      name: 'reports a non-@types unused dep while still holding @types',
      imports: [],
      pkgJson: {
        main: './src/index.ts',
        dependencies: { 'dead-lib': '^1.0.0' },
        devDependencies: { '@types/node': '^20.0.0' },
      },
      expectedUnusedDeps: [{ kind: 'unused-dependency', packageName: 'dead-lib' }],
      expectedUnresolved: [],
    },
  ];

  it.each(importCases)('$name', async ({ imports, pkgJson, ignoreDependencies, expectedUnusedDeps, expectedUnresolved }) => {
    const result = await analyzeImports(imports, pkgJson, ignoreDependencies);
    const actualUnresolved = result.unresolvedImports.map(u => ({ specifier: u.specifier, module: u.module }));

    expect(toKindName(result)).toEqual([...expectedUnusedDeps]);
    expect(actualUnresolved).toEqual([...expectedUnresolved]);
  });

  it('should hold an unresolved internal import when the target file exists on disk (partial index, not TS)', async () => {
    // 외부 코퍼스 검증에서 잡힌 FP: `import data from './data.json'` 처럼 대상이 디스크에
    // 실존하지만 비-TS라 gildash 그래프에 인덱싱되지 않으면 dstFilePath=null 로 온다.
    // 이는 "해결 실패"가 아니라 "TS 인덱스 밖" — 전체-인덱싱 전제상 보류(FN)여야 하며
    // unresolved-import 로 보고하면 안 된다. 대상이 어디에도 없을 때만 진짜 unresolved.
    const imports = [mkImport('/project/src/index.ts', null, null, { isExternal: false, specifier: './data.json' })];
    const g = importsGildash(new Map<string, string[]>([['/project/src/index.ts', []]]), imports);
    const readFileFn = (p: string): string => {
      if (p === `${ROOT}/package.json`) {
        return JSON.stringify({ main: './src/index.ts' });
      }

      if (p === `${ROOT}/src/data.json`) {
        return '{}';
      }

      throw new Error(`ENOENT: ${p}`);
    };

    const result = await analyzeDependencies(g, { rootAbs: ROOT, readFileFn });

    expect(result.unresolvedImports).toEqual([]);
  });

  it('does not flag a bare Node builtin (`path`) as an unlisted dependency (builtinModules fact)', async () => {
    // 외부 코퍼스 FP: `import { join } from 'path'` — bare Node builtin 은 외부 패키지가 아니다.
    // Node 는 bare core specifier 를 항상 core 로 해석(동명 npm 패키지보다 우선)하므로
    // `module.builtinModules` 목록(런타임 사실)에 있으면 unlisted-dependency 가 아니다.
    const result = await analyzeImports(
      [mkImport('/project/src/index.ts', null, null, { isExternal: true, specifier: 'path' })],
      { main: './src/index.ts' },
    );

    expect(result.unusedDeps.filter(d => d.kind === 'unlisted-dependency')).toEqual([]);
  });

  it('does not flag a dependency consumed only via `import type` (type-references, not imports)', async () => {
    // 외부 코퍼스 FP: `import type { Foo } from 'type-lib'` 도 type-lib 소비다. gildash 는 이를
    // 'imports' 가 아니라 'type-references' 관계로 기록하므로, 외부 type-references 도 used-package
    // 로 세야 type-only import 로만 쓰인 dep 이 unused-dependency 로 오판되지 않는다.
    const g = createMockGildash({
      getImportGraph: async () => new Map<string, string[]>([['/project/src/index.ts', []]]),
      searchSymbols: () => [],
      searchRelations: (q: unknown) => {
        const query = q as { type?: string };

        if (query.type === 'type-references') {
          return [
            {
              type: 'type-references' as StoredCodeRelation['type'],
              srcFilePath: '/project/src/index.ts',
              srcSymbolName: null,
              dstFilePath: null,
              dstSymbolName: 'Foo',
              dstProject: null,
              isExternal: true,
              specifier: 'type-lib',
            },
          ];
        }

        return [];
      },
    });

    const result = await analyzeDependencies(g, {
      rootAbs: ROOT,
      readFileFn: rootOnlyRead({ main: './src/index.ts', dependencies: { 'type-lib': '^1.0.0' } }),
    });

    expect(result.unusedDeps.map(d => d.packageName)).toEqual([]);
  });

  it('does not flag a type-only import as unlisted when satisfied by an @types-only declaration', async () => {
    // 삼자리뷰(subagent): `import type { Request } from 'express'` 이 `@types/express` 만 선언된
    // 경우 — type-only import 의 계약은 @types 로도 충족되고 런타임 로드가 없으므로 express 를
    // unlisted-dependency 로 보고하면 안 된다. type-references 는 unused 억제에만 기여(unlisted 생성 X).
    const g = createMockGildash({
      getImportGraph: async () => new Map<string, string[]>([['/project/src/index.ts', []]]),
      searchSymbols: () => [],
      searchRelations: (q: unknown) => {
        const query = q as { type?: string };

        if (query.type === 'type-references') {
          return [
            {
              type: 'type-references' as StoredCodeRelation['type'],
              srcFilePath: '/project/src/index.ts',
              srcSymbolName: null,
              dstFilePath: null,
              dstSymbolName: 'Request',
              dstProject: null,
              isExternal: true,
              specifier: 'express',
            },
          ];
        }

        return [];
      },
    });

    const result = await analyzeDependencies(g, {
      rootAbs: ROOT,
      readFileFn: rootOnlyRead({ main: './src/index.ts', devDependencies: { '@types/express': '^4.0.0' } }),
    });

    expect(result.unusedDeps).toEqual([]);
  });

  it('holds a declared dep whose name is a Node builtin when imported (polyfill intent)', async () => {
    // `buffer`/`events`/`punycode` 등은 builtinModules 에도 있지만 npm 폴리필로도 선언·사용된다.
    // 번들러/브라우저 타깃이면 npm 패키지가 로드되므로(타깃 환경은 사실로 안 닫힘), 선언 + import 된
    // builtin-이름 dep 은 unused 로도 unlisted 로도 보고하면 안 된다 (선언 = 폴리필 의도 사실).
    const result = await analyzeImports(
      [mkImport('/project/src/index.ts', null, null, { isExternal: true, specifier: 'buffer' })],
      { main: './src/index.ts', dependencies: { buffer: '^6.0.0' } },
    );

    expect(result.unusedDeps).toEqual([]);
  });

  /* ---------- AT: unused-dependency holds ambient-type packages (tsconfig-resolved) ---------- */

  describe('unused-dependency holds ambient-type packages', () => {
    // A readFn serving root package.json + tsconfig(.json) + installed no-bin manifests.
    // `tsconfig` is raw text (jsonc allowed). `dtsByPkg` maps `node_modules/<pkg>/index.d.ts`
    // content so reference-chain (`@types/bun` → `bun-types`) can be exercised.
    const ambientReadFn =
      (opts: {
        deps?: Record<string, string>;
        tsconfig?: string | null;
        tsconfigPath?: string;
        extraFiles?: Record<string, string>;
        dtsByPkg?: Record<string, string>;
      }) =>
      (p: string): string => {
        if (p === `${ROOT}/package.json`) {
          return JSON.stringify({ main: './src/index.ts', devDependencies: opts.deps ?? {} });
        }

        if (opts.tsconfig != null && p === `${ROOT}/${opts.tsconfigPath ?? 'tsconfig.json'}`) {
          return opts.tsconfig;
        }

        if (opts.extraFiles && p in opts.extraFiles) {
          return opts.extraFiles[p]!;
        }

        const dtsHit = opts.dtsByPkg
          ? Object.entries(opts.dtsByPkg).find(([pkg]) => p === `${ROOT}/node_modules/${pkg}/index.d.ts`)
          : undefined;

        if (dtsHit) {
          return dtsHit[1];
        }

        if (/\/node_modules\/(@[^/]+\/)?[^/]+\/package\.json$/.test(p)) {
          // installed, no `bin` → 'no-bin' so the dep is a reportable candidate (not a bin-hold).
          return /\/(bun-types|@types\/bun)\/package\.json$/.test(p) ? JSON.stringify({ types: './index.d.ts' }) : '{}';
        }

        throw new Error(`ENOENT: ${p}`);
      };

    const runAmbient = (
      readFileFn: (p: string) => string,
      listDirFn?: (dir: string) => ReadonlyArray<string>,
    ): Promise<Awaited<ReturnType<typeof analyzeDependencies>>> =>
      analyzeDependencies(importsGildash(new Map<string, string[]>([['/project/src/index.ts', []]])), {
        rootAbs: ROOT,
        readFileFn,
        ...(listDirFn === undefined ? {} : { listDirFn }),
      });

    it('holds bun-types when tsconfig compilerOptions.types lists it (jsonc-safe)', async () => {
      // 외부 코퍼스 FP: `bun-types` 는 import 없이 ambient 전역 제공. tsconfig `types` 에
      // 나열됐다는 선언된 사실로 보류해야 한다. tsconfig 는 주석 포함 jsonc — plain JSON.parse
      // 면 파싱 실패로 fix 가 무효화되므로, jsonc 경로가 실제로 동작함을 이 케이스가 실증한다.
      const result = await runAmbient(
        ambientReadFn({
          deps: { 'bun-types': '^1.0.0' },
          tsconfig: '{\n  // bun ambient types\n  "compilerOptions": { "types": ["bun-types"] },\n}',
        }),
      );

      expect(result.unusedDeps.map(d => d.packageName)).toEqual([]);
    });

    it('holds bun-types via the @types/bun → bun-types reference chain (no import, no `types`)', async () => {
      // 최신 Bun 스택: `@types/bun` 이 자동포함(default typeRoot)되고 그 entry .d.ts 가
      // `/// <reference types="bun-types" />` 로 `bun-types` 를 끌어온다. 둘 다 직접 선언한
      // 레포에서 `bun-types` 는 import 없이 참조체인으로 로드 → 보류해야 한다.
      const result = await runAmbient(
        ambientReadFn({
          deps: { '@types/bun': '^1.0.0', 'bun-types': '^1.0.0' },
          tsconfig: null,
          dtsByPkg: { '@types/bun': '/// <reference types="bun-types" />\nexport {};' },
        }),
      );

      expect(result.unusedDeps.map(d => d.packageName)).toEqual([]);
    });

    it('holds the owner package of a subpath `types` entry (`types:["foo/sub"]` → hold `foo`)', async () => {
      // codex 실증: `types:["foo/sub"]` 가 node_modules/foo/sub.d.ts 를 로드. 선언 dep 은 `foo`
      // 라 정확문자열만 보류하면 false-W → 패키지 루트까지 보류해야 한다.
      const result = await runAmbient(
        ambientReadFn({ deps: { foo: '^1.0.0' }, tsconfig: '{ "compilerOptions": { "types": ["foo/sub"] } }' }),
      );

      expect(result.unusedDeps.map(d => d.packageName)).toEqual([]);
    });

    it('holds bun-types listed only in an extends base (TS compiler API merges extends)', async () => {
      const result = await runAmbient(
        ambientReadFn({
          deps: { 'bun-types': '^1.0.0' },
          tsconfig: '{ "extends": "./tsconfig.base.json" }',
          extraFiles: { [`${ROOT}/tsconfig.base.json`]: '{ "compilerOptions": { "types": ["bun-types"] } }' },
        }),
      );

      expect(result.unusedDeps.map(d => d.packageName)).toEqual([]);
    });

    it('holds a project-source triple-slash reference (`/// <reference types="X" />`)', async () => {
      // `/// <reference types="some-types" />` 는 명세정의 구문의 명시적 소비 선언 = 사실.
      const result = await runAmbient(
        ambientReadFn({
          deps: { 'some-types': '^1.0.0' },
          tsconfig: null,
          extraFiles: { '/project/src/index.ts': '/// <reference types="some-types" />\nexport const a = 1;\n' },
        }),
      );

      expect(result.unusedDeps.map(d => d.packageName)).toEqual([]);
    });

    it('reports a plain non-ambient dep with no import/types/reference (TP — no over-hold)', async () => {
      // 순수 라이브러리 dead-lib: import 0·types 미나열·참조 없음 → 진짜 미사용 = 보고(TP).
      // v1 이 `bun-types` 를 이 TP 예시로 쓰던 테스트는 참조체인으로 false-W 가 될 수 있어 폐기,
      // ambient 아닌 dead-lib 로 교체.
      const result = await runAmbient(ambientReadFn({ deps: { 'dead-lib': '^1.0.0' }, tsconfig: '{}' }));

      expect(result.unusedDeps.map(d => d.packageName)).toEqual(['dead-lib']);
    });

    it('keeps the @types/* blanket hold unconditional even when `types` omits it [G1]', async () => {
      // `types:["node"]` 는 tsc 상 @types 자동포함을 좁히지만, 그걸 흉내내면 미나열 @types 마다
      // false-W. `@types/lodash` 는 여전히 무조건 보류돼야 한다.
      const result = await runAmbient(
        ambientReadFn({ deps: { '@types/lodash': '^4.0.0' }, tsconfig: '{ "compilerOptions": { "types": ["node"] } }' }),
      );

      expect(result.unusedDeps.map(d => d.packageName)).toEqual([]);
    });

    it('HOLDs every unimported dep at a root whose `extends` base is unreadable (e)', async () => {
      // 못 읽는 extends → ambient 집합 미닫힘 → 그 root 의 non-import·non-bin dep 전량 HOLD.
      const result = await runAmbient(
        ambientReadFn({ deps: { 'dead-lib': '^1.0.0' }, tsconfig: '{ "extends": "./missing-base.json" }' }),
      );

      expect(result.unusedDeps.map(d => d.packageName)).toEqual([]);
    });

    it('HOLDs every unimported dep when custom typeRoots is set with no explicit `types` (e)', async () => {
      const result = await runAmbient(
        ambientReadFn({ deps: { 'dead-lib': '^1.0.0' }, tsconfig: '{ "compilerOptions": { "typeRoots": ["./types"] } }' }),
      );

      expect(result.unusedDeps.map(d => d.packageName)).toEqual([]);
    });

    it('HOLDs (no crash) when a present tsconfig is unparseable garbage [G2]', async () => {
      const result = await runAmbient(
        ambientReadFn({ deps: { 'dead-lib': '^1.0.0' }, tsconfig: '{ this is : not json ]' }),
      );

      expect(result.unusedDeps.map(d => d.packageName)).toEqual([]);
    });

    it('holds a `preserve="…" types="X"` directive (TS preProcessFile, not a hand regex)', async () => {
      // codex 실증 FP: `types` 가 첫 속성이 아니면 hand regex 가 놓친다. TS 자체 파서로 처리.
      const result = await runAmbient(
        ambientReadFn({
          deps: { 'some-types': '^1.0.0' },
          tsconfig: null,
          extraFiles: { '/project/src/index.ts': '/// <reference preserve="true" types="some-types" />\nexport {};\n' },
        }),
      );

      expect(result.unusedDeps.map(d => d.packageName)).toEqual([]);
    });

    it('follows project `references` (TS does not merge referenced `types`)', async () => {
      // grok HIGH: solution-style root(`files:[]`, `references`)의 참조 config 에만 types 가
      // 있는 경우 — TS 는 병합하지 않으므로 각 참조 config 를 직접 열어야 한다.
      const result = await runAmbient(
        ambientReadFn({
          deps: { 'bun-types': '^1.0.0' },
          tsconfig: '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }',
          extraFiles: { [`${ROOT}/tsconfig.app.json`]: '{ "compilerOptions": { "types": ["bun-types"] } }' },
        }),
      );

      expect(result.unusedDeps.map(d => d.packageName)).toEqual([]);
    });

    it('HOLDs when an extends base is present but malformed (TS1005 → unclosable) [C]', async () => {
      // codex/subagent LOW: 못 읽는 extends 는 5083/6053 이지만 존재하나 깨진 base 는 1005.
      // 18003(no-inputs) 외 모든 진단을 unclosable 로 처리 → 신뢰 못 하는 config 는 HOLD.
      const result = await runAmbient(
        ambientReadFn({
          deps: { 'dead-lib': '^1.0.0' },
          tsconfig: '{ "extends": "./base.json" }',
          extraFiles: { [`${ROOT}/base.json`]: '{ "compilerOptions": { "types": ["bun-types"]' },
        }),
      );

      expect(result.unusedDeps.map(d => d.packageName)).toEqual([]);
    });

    it('resolves a held package entry .d.ts via `exports["."].types` in the reference chain', async () => {
      // codex #2: entry .d.ts 가 exports 로만 노출되면 index.d.ts 폴백이 참조체인을 끊는다.
      const result = await runAmbient(
        ambientReadFn({
          deps: { '@types/bun': '^1.0.0', 'bun-types': '^1.0.0' },
          tsconfig: null,
          extraFiles: {
            '/project/node_modules/@types/bun/package.json': JSON.stringify({ exports: { '.': { types: './idx.d.ts' } } }),
            '/project/node_modules/@types/bun/idx.d.ts': '/// <reference types="bun-types" />\nexport {};',
          },
        }),
      );

      expect(result.unusedDeps.map(d => d.packageName)).toEqual([]);
    });

    it('resolves entry .d.ts via a condition-first `exports["."].import.types` (dual ESM/CJS shape)', async () => {
      // codex/grok HIGH: 최신 dual 패키지는 `exports["."].import.types` 처럼 조건이 먼저,
      // types 가 그 안에 온다. index.d.ts 폴백이면 참조체인이 끊겨 bun-types false-W.
      const result = await runAmbient(
        ambientReadFn({
          deps: { '@types/bun': '^1.0.0', 'bun-types': '^1.0.0' },
          tsconfig: null,
          extraFiles: {
            '/project/node_modules/@types/bun/package.json': JSON.stringify({
              exports: {
                '.': {
                  import: { types: './dist/index.d.mts', default: './dist/index.mjs' },
                  require: { types: './dist/index.d.ts', default: './dist/index.cjs' },
                },
              },
            }),
            '/project/node_modules/@types/bun/dist/index.d.mts': '/// <reference types="bun-types" />\nexport {};',
          },
        }),
      );

      expect(result.unusedDeps.map(d => d.packageName)).toEqual([]);
    });

    it('HOLDs when a declared @types package cannot be resolved in node_modules (chain unprovable)', async () => {
      // grok MED (B): 선언된 @types/* 가 walk 에서 안 읽히면 참조체인을 증명 못 함 → hold-all.
      const result = await runAmbient(
        ambientReadFn({
          deps: { '@types/bun': '^1.0.0', 'dead-lib': '^1.0.0' },
          tsconfig: null,
          extraFiles: { '/project/node_modules/@types/bun/package.json': '' }, // present-but-empty → JSON.parse throws → unreadable
        }),
      );

      expect(result.unusedDeps.map(d => d.packageName)).toEqual([]);
    });

    it('HOLDs when a project reference points to a missing config (chain unprovable)', async () => {
      // codex MED: 선언된 references 대상이 없으면 ambient 집합을 증명 못 함 → hold-all.
      const result = await runAmbient(
        ambientReadFn({
          deps: { 'dead-lib': '^1.0.0' },
          tsconfig: '{ "files": [], "references": [{ "path": "./tsconfig.missing.json" }] }',
        }),
      );

      expect(result.unusedDeps.map(d => d.packageName)).toEqual([]);
    });

    it('does not let a broken sibling tsconfig force a root-wide hold (additive-only)', async () => {
      // grok #3: 형제 tsconfig.eslint.json 가 깨져도 그것 때문에 루트 전체 unused-dep 이
      // 침묵되면 안 된다 (형제는 additive widen 소스). dead-lib 는 정상 보고돼야 한다.
      const result = await runAmbient(
        ambientReadFn({
          deps: { 'dead-lib': '^1.0.0' },
          tsconfig: '{ "compilerOptions": {} }',
          extraFiles: { [`${ROOT}/tsconfig.eslint.json`]: '{ "compilerOptions": { "types": ["x"]' }, // malformed sibling
        }),
        (dir: string) => (dir === ROOT ? ['tsconfig.json', 'tsconfig.eslint.json'] : []),
      );

      expect(result.unusedDeps.map(d => d.packageName)).toEqual(['dead-lib']);
    });

    it('terminates on a self/cyclic `reference path` chain and still holds the real type ref', async () => {
      // 파일-BFS 종료 보장: entry .d.ts 가 자기 자신을 path-참조해도 seenFiles 로 멈춰야 하고
      // (해시 타임아웃 없이), 같은 파일의 types 참조는 정상 보류돼야 한다.
      const result = await runAmbient(
        ambientReadFn({
          deps: { '@types/bun': '^1.0.0', 'bun-types': '^1.0.0' },
          tsconfig: null,
          dtsByPkg: { '@types/bun': '/// <reference path="./index.d.ts" />\n/// <reference types="bun-types" />\nexport {};' },
        }),
      );

      expect(result.unusedDeps.map(d => d.packageName)).toEqual([]);
    });

    it('enumerates sibling `tsconfig*.json` via listDirFn (types only in tsconfig.build.json)', async () => {
      // grok HIGH: 루트 tsconfig.json 에 types 가 없고 형제 tsconfig.build.json 에만 있어도
      // 보류해야 한다. listDirFn(fs-backed in prod)으로 루트 tsconfig*.json 을 열거한다.
      const result = await runAmbient(
        ambientReadFn({
          deps: { 'bun-types': '^1.0.0' },
          tsconfig: '{ "compilerOptions": {} }',
          extraFiles: { [`${ROOT}/tsconfig.build.json`]: '{ "compilerOptions": { "types": ["bun-types"] } }' },
        }),
        (dir: string) => (dir === ROOT ? ['tsconfig.json', 'tsconfig.build.json'] : []),
      );

      expect(result.unusedDeps.map(d => d.packageName)).toEqual([]);
    });
  });

  /* ---------- SB: unused-dependency holds any bin-providing dep (declared `bin` = fact) ---------- */

  describe('unused-dependency holds a dep that provides a binary', () => {
    // readFileFn that serves the root package.json AND each dep's installed
    // node_modules/<dep>/package.json (so the analyzer can read its `bin` field).
    // `undefined` in binsByDep means "manifest readable but no `bin` field" (a pure library).
    const readWithBins =
      (rootPkg: unknown, binsByDep: Record<string, unknown>) =>
      (p: string): string => {
        if (p === `${ROOT}/package.json`) {
          return JSON.stringify(rootPkg);
        }

        for (const [dep, bin] of Object.entries(binsByDep)) {
          if (p === `${ROOT}/node_modules/${dep}/package.json`) {
            return JSON.stringify({ name: dep, bin });
          }
        }

        throw new Error(`ENOENT: ${p}`);
      };

    const run = async (rootPkg: unknown, binsByDep: Record<string, unknown> = {}) => {
      const g = importsGildash(new Map<string, string[]>([['/project/src/index.ts', []]]));

      return analyzeDependencies(g, { rootAbs: ROOT, readFileFn: readWithBins(rootPkg, binsByDep) });
    };

    const unusedNames = (r: Awaited<ReturnType<typeof analyzeDependencies>>): string[] =>
      r.unusedDeps.filter(d => d.kind === 'unused-dependency').map(d => d.packageName);

    it('holds a bin-provider whose bin name differs from the package name (typescript→tsc)', async () => {
      const r = await run(
        { main: './src/index.ts', devDependencies: { typescript: '^5.0.0' } },
        { typescript: { tsc: './bin/tsc', tsserver: './bin/tsserver' } },
      );

      expect(unusedNames(r)).toEqual([]);
    });

    it('holds a bin-provider regardless of HOW it is invoked — even via a path (no false-W)', async () => {
      // The token approach missed `node_modules/.bin/tsc` (no `/` split) → false-W. Bin-existence
      // holds it independent of the invocation form the static graph cannot parse.
      const r = await run(
        { main: './src/index.ts', devDependencies: { typescript: '^5.0.0' }, scripts: { build: 'node_modules/.bin/tsc -p .' } },
        { typescript: { tsc: './bin/tsc' } },
      );

      expect(unusedNames(r)).toEqual([]);
    });

    it('holds a bin-provider even when it is not referenced anywhere (manual/hook/bunx unobservable)', async () => {
      const r = await run(
        { main: './src/index.ts', devDependencies: { 'some-cli': '^1.0.0' }, scripts: {} },
        { 'some-cli': { 'some-cli': './cli.js' } },
      );

      expect(unusedNames(r)).toEqual([]);
    });

    it('holds a string-form bin (any non-empty bin field counts)', async () => {
      const r = await run(
        { main: './src/index.ts', devDependencies: { husky: '^9.0.0' } },
        { husky: './bin.js' },
      );

      expect(unusedNames(r)).toEqual([]);
    });

    it('holds a scoped bin-provider', async () => {
      const r = await run(
        { main: './src/index.ts', devDependencies: { '@myorg/cli': '^1.0.0' } },
        { '@myorg/cli': { mycli: './cli.js' } },
      );

      expect(unusedNames(r)).toEqual([]);
    });

    it('reports a no-bin library that is not imported (readable manifest, no bin → provably unused)', async () => {
      const r = await run(
        { main: './src/index.ts', dependencies: { 'dead-lib': '^1.0.0' }, devDependencies: { typescript: '^5.0.0' } },
        { 'dead-lib': undefined, typescript: { tsc: './bin/tsc' } },
      );

      expect(unusedNames(r)).toEqual(['dead-lib']);
    });

    it('reports a dep with an empty bin object (exposes no command)', async () => {
      const r = await run(
        { main: './src/index.ts', dependencies: { 'empty-bin': '^1.0.0' } },
        { 'empty-bin': {} },
      );

      expect(unusedNames(r)).toEqual(['empty-bin']);
    });

    it('HOLDS a dep whose manifest is unreadable (pnpm/Yarn-PnP/hoist-above-root → unknown, not a false-W)', async () => {
      // No node_modules manifest served at all → readDepBinState returns 'unknown'. Reporting
      // here would falsely flag every bin-provider under Yarn PnP (no node_modules) or pnpm's
      // non-flat store. Per "닫히지 않으면 보류", unknown holds.
      const readNoModules =
        (rootPkg: unknown) =>
        (p: string): string => {
          if (p === `${ROOT}/package.json`) {
            return JSON.stringify(rootPkg);
          }

          throw new Error(`ENOENT: ${p}`);
        };
      const g = importsGildash(new Map<string, string[]>([['/project/src/index.ts', []]]));

      const r = await analyzeDependencies(g, {
        rootAbs: ROOT,
        readFileFn: readNoModules({ main: './src/index.ts', devDependencies: { typescript: '^5.0.0' } }),
      });

      expect(unusedNames(r)).toEqual([]);
    });
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

  it('resolves a dep manifest hoisted above the workspace root (upward walk to rootAbs)', async () => {
    // ws1 declares `hoisted-lib`; its manifest is NOT under the workspace node_modules but is
    // hoisted to the project-root node_modules with NO `bin`. Only if readDepBinState walks
    // depRoot→rootAbs does it read `no-bin` → report. If the walk stopped at the workspace, it
    // would be `unknown` → held. Asserting it IS reported proves the walk reaches rootAbs.
    const g = importsGildash(new Map<string, string[]>([['/project/packages/ws1/src/index.ts', []]]));
    const result = await analyzeDependencies(g, {
      rootAbs: ROOT,
      readFileFn: (p: string) => {
        if (p === '/project/packages/ws1/package.json') {
          return JSON.stringify({ name: 'ws1', dependencies: { 'hoisted-lib': '^1.0.0' } });
        }

        if (p === '/project/node_modules/hoisted-lib/package.json') {
          return JSON.stringify({ name: 'hoisted-lib' });
        }

        // workspace-local node_modules miss + everything else (root manifest, etc.)
        if (/\/node_modules\//.test(p)) {
          throw new Error(`ENOENT: ${p}`);
        }

        return JSON.stringify({});
      },
      workspacePackages: new Map([['ws1', '/project/packages/ws1']]),
    });

    expect(toKindName(result)).toEqual([{ kind: 'unused-dependency', packageName: 'hoisted-lib' }]);
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
        { kind: 'enum', name: 'Color', memberName: null, isExported: true, span: ROW_SPAN },
        { kind: 'property', name: 'Color.Red', memberName: 'Red', isExported: false, span: ROW_SPAN },
        { kind: 'property', name: 'Color.Green', memberName: 'Green', isExported: false, span: ROW_SPAN },
        { kind: 'property', name: 'Color.Blue', memberName: 'Blue', isExported: false, span: ROW_SPAN },
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
        { kind: 'namespace', name: 'Guards', memberName: null, isExported: true, span: ROW_SPAN },
        { kind: 'function', name: 'Guards.isString', memberName: 'isString', isExported: false, span: ROW_SPAN },
        { kind: 'function', name: 'Guards.isNumber', memberName: 'isNumber', isExported: false, span: ROW_SPAN },
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
    // `import * as Color` → usesAll. An attributed call to Color.Red exists (so the
    // calls-0 hold does NOT fire) — the skip must come from the usesAll gate itself:
    // the uncalled Blue member is NOT reported.
    const result = await analyzeMembers({
      container: mkSymbol(1, '/project/src/colors.ts', 'Color', 'enum'),
      containerFile: '/project/src/colors.ts',
      importName: '*',
      calledMembers: ['Color.Red'],
      members: [
        { kind: 'enum', name: 'Color', memberName: null, isExported: true, span: ROW_SPAN },
        { kind: 'property', name: 'Color.Red', memberName: 'Red', isExported: false, span: ROW_SPAN },
        { kind: 'property', name: 'Color.Blue', memberName: 'Blue', isExported: false, span: ROW_SPAN },
      ],
    });

    expect(result.unusedMembers.length).toBe(0);
  });

  it('should hold a type-only namespace member (used via type-references, never called)', async () => {
    // 외부 코퍼스 검증에서 잡힌 FP: namespace 안의 `type ErrMessage = …` 는 타입 참조로만
    // 소비되어 호출 관계에 절대 나타나지 않는다. 멤버 검출이 호출만 세므로 타입 멤버는
    // "미호출 = dead"로 오판된다. 타입 멤버는 call-oracle로 관측 불가 → 보류(FN)여야 한다.
    // build(값 멤버)는 호출되어 parent-use 증거를 제공하지만, ErrMessage(타입 멤버)는
    // 어떤 unused-ns-member 로도 보고되면 안 된다.
    const result = await analyzeMembers({
      container: mkSymbol(1, '/project/src/ns.ts', 'Ns', 'namespace'),
      containerFile: '/project/src/ns.ts',
      importName: 'Ns',
      calledMembers: ['Ns.build'],
      members: [
        { kind: 'namespace', name: 'Ns', memberName: null, isExported: true, span: ROW_SPAN },
        { kind: 'function', name: 'Ns.build', memberName: 'build', isExported: false, span: ROW_SPAN },
        { kind: 'type', name: 'Ns.ErrMessage', memberName: 'ErrMessage', isExported: false, span: ROW_SPAN },
      ],
    });

    expect(result.unusedMembers.map(m => m.memberName)).toEqual([]);
  });

  it('should hold the member verdict when no call to any parent member is observed', async () => {
    // calls-0 → no usage evidence for the parent at all → verdict held (no member W).
    const result = await analyzeMembers({
      container: mkSymbol(1, '/project/src/colors.ts', 'Color', 'enum'),
      containerFile: '/project/src/colors.ts',
      importName: 'Color',
      calledMembers: [],
      members: [
        { kind: 'enum', name: 'Color', memberName: null, isExported: true, span: ROW_SPAN },
        { kind: 'property', name: 'Color.Red', memberName: 'Red', isExported: false, span: ROW_SPAN },
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
        ['/project/src/consumer.ts', ['/project/src/index.ts']],
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
        ['/project/src/consumer.ts', ['/project/src/index.ts']],
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
      pkgJson: { main: './src/consumer.ts' },
    });

    expectSingleNamed(indexDeadExports(result), 'deadFn');
  });

  it('should collect type re-exports via meta.isReExport and detect dead ones', async () => {
    // types.ts does `export type { MyConfig } from './shared/config'` but nobody imports it via types.ts → dead.
    const result = await analyzeWithExports({
      graph: new Map([
        ['/project/src/app.ts', ['/project/src/types.ts']],
        ['/project/src/types.ts', ['/project/src/shared/config.ts']],
        ['/project/src/shared/config.ts', []],
      ]),
      exported: [mkSymbol(1, '/project/src/shared/config.ts', 'MyConfig', 'type')],
      searchRelations: relationsOfType('type-references', [
        mkTypeRef('/project/src/types.ts', '/project/src/shared/config.ts', 'MyConfig', true),
      ]),
      pkgJson: { main: './src/app.ts' },
    });
    const deadReExports = result.deadExports.filter(d => d.module === 'src/types.ts');

    expect(deadReExports.length).toBe(1);
    expect(deadReExports[0]!.name).toBe('MyConfig');
  });

  it('should propagate dead through re-export chain — original also dead when only consumer is dead re-export', async () => {
    // index.ts re-exports orphanFn but nobody imports from index.ts → both index.ts re-export and lib.ts original are dead.
    const result = await analyzeWithExports({
      graph: new Map([
        ['/project/src/consumer.ts', ['/project/src/index.ts']],
        ['/project/src/index.ts', ['/project/src/lib.ts']],
        ['/project/src/lib.ts', []],
      ]),
      exported: [mkSymbol(1, '/project/src/lib.ts', 'orphanFn', 'function')],
      searchRelations: relationsOfType('re-exports', [
        mkReExport('/project/src/index.ts', '/project/src/lib.ts', 'orphanFn', 'orphanFn'),
      ]),
      pkgJson: { main: './src/consumer.ts' },
    });
    const libDead = result.deadExports.filter(d => d.module === 'src/lib.ts');

    expectSingleNamed(indexDeadExports(result), 'orphanFn');
    expectSingleNamed(libDead, 'orphanFn');
  });

  /* ---------- DG: Relation degrade → dead-family verdicts held (B1) ---------- */

  // When `imports` indexes successfully but one of the completeness relations
  // (re-exports / type-references / calls) throws GildashError, the "usage = 0"
  // family (dead-export / unused-member) must be HELD to avoid
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
    const result = await analyzeDependencies(g, { rootAbs: ROOT, readFileFn: rootOnlyRead({ main: './src/main.ts' }) });

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
    const result = await analyzeDependencies(g, { rootAbs: ROOT, readFileFn: rootOnlyRead({ main: './src/index.ts' }) });

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
    const result = await analyzeDependencies(g, { rootAbs: ROOT, readFileFn: rootOnlyRead({ main: './src/index.ts' }) });
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
    const result = await analyzeDependencies(g, { rootAbs: ROOT, readFileFn: rootOnlyRead({ main: './src/index.ts' }) });

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
    const result = await analyzeDependencies(g, { rootAbs: ROOT, readFileFn: rootOnlyRead({ main: './src/barrel.ts' }) });

    expectSingleMissingUnresolved(result);
    expect(result.unresolvedImports[0]!.module).toBe('src/barrel.ts');
  });

  /* ---------- EN: entry-module exports are an external contract ---------- */
  //
  // 진입점(패키지 진입점 ∪ 사용자 entry glob)의 소비자는 정의상 그래프 밖(러너·도구·
  // 외부 패키지)이다 — 그 파일의 export에 내부 소비자가 없어도 dead가 아니라 외부 계약.
  // (예: drizzle.config.ts를 entry로 선언하면 drizzle-kit이 문자열로 로드하는 export가
  // dead-export에서 면제된다.)

  describe('entry-module exports are exempt from dead-export', () => {
    it('holds dead-export for an export in a user-declared entry module', async () => {
      const result = await analyzeWithExports({
        graph: new Map([['/project/tool.config.ts', []]]),
        exported: [mkSymbol(1, '/project/tool.config.ts', 'toolConfig')],
        pkgJson: {},
        entry: ['tool.config.ts'],
      });

      expect(result.deadExports.length).toBe(0);
    });

    it('holds dead-export for an entry-glob module ABSENT from the import graph (tool-loaded config)', async () => {
      // drizzle.config.ts류: 아무도 import하지 않아 import graph에 노드가 없고,
      // 심볼 인덱스(exportsByFile)에만 존재한다 — entry 매칭은 그래프 키만 돌면 놓친다.
      const result = await analyzeWithExports({
        graph: new Map([['/project/src/main.ts', []]]),
        exported: [mkSymbol(1, '/project/tool.config.ts', 'toolConfig')],
        pkgJson: { main: './src/main.ts' },
        entry: ['tool.config.ts'],
      });

      expect(result.deadExports.length).toBe(0);
    });

    it('holds dead-export for an export in a package.json entrypoint module', async () => {
      const result = await analyzeWithExports({
        graph: new Map([['/project/src/main.ts', []]]),
        exported: [mkSymbol(1, '/project/src/main.ts', 'runCli')],
        pkgJson: { main: './src/main.ts' },
      });

      expect(result.deadExports.length).toBe(0);
    });

    it('still reports dead-export for a non-entry module (guard)', async () => {
      // lib은 main이 import해 도달 가능(unused-file 아님)하지만 그 export의 심볼 소비자는 0.
      const result = await analyzeWithExports({
        graph: new Map([
          ['/project/src/main.ts', ['/project/src/lib.ts']],
          ['/project/src/lib.ts', []],
        ]),
        exported: [mkSymbol(1, '/project/src/lib.ts', 'unusedFn')],
        pkgJson: { main: './src/main.ts' },
        entry: ['**/main.ts'],
      });

      expect(result.deadExports.map(d => d.name)).toEqual(['unusedFn']);
    });
  });

  /* ---------- DY: dynamic import = whole-namespace consumption ---------- */
  //
  // `await import('./lib')`는 런타임 의미론상 모듈 네임스페이스 객체 전체를 받는다 —
  // namespace `*` import와 동등한 전량 소비. gildash는 meta.isDynamic으로 이를 닫힌
  // 사실로 구분한다(side-effect import는 meta 없음 — 전량 소비 아님, 스펙 그대로).

  describe('dynamic import consumes the whole module namespace', () => {
    it('holds dead-export for a module consumed via await import() (meta.isDynamic)', async () => {
      const result = await analyzeWithExports({
        graph: new Map([
          ['/project/src/consumer.ts', ['/project/src/lib.ts']],
          ['/project/src/lib.ts', []],
        ]),
        exported: [mkSymbol(1, '/project/src/lib.ts', 'a'), mkSymbol(2, '/project/src/lib.ts', 'b')],
        searchRelations: relationsOfType('imports', [mkImport('/project/src/consumer.ts', '/project/src/lib.ts', null, { meta: { isDynamic: true } })]),
        pkgJson: { main: './src/consumer.ts' },
      });

      expect(result.deadExports.length).toBe(0);
    });

    it('still reports dead-export for a side-effect-only import (no meta — no consumption)', async () => {
      const result = await analyzeWithExports({
        graph: new Map([
          ['/project/src/consumer.ts', ['/project/src/lib.ts']],
          ['/project/src/lib.ts', []],
        ]),
        exported: [mkSymbol(1, '/project/src/lib.ts', 'a')],
        searchRelations: relationsOfType('imports', [mkImport('/project/src/consumer.ts', '/project/src/lib.ts', null)]),
        pkgJson: { main: './src/consumer.ts' },
      });

      expect(result.deadExports.map(d => d.name)).toEqual(['a']);
    });
  });

  /* ---------- SP: finding spans carry the gildash symbol location ---------- */
  //
  // gildash 심볼에는 span이 있는데 변환 파이프라인이 ZERO_SPAN을 합성해 리포트가
  // 위치를 잃었다(자체 검사에서 실증). 심볼-기반 kind는 심볼 span을 그대로 나른다.

  describe('finding spans carry the gildash symbol location', () => {

    it('dead-export carries the exported symbol span', async () => {
      const result = await analyzeWithExports({
        graph: new Map([
          ['/project/src/main.ts', ['/project/src/lib.ts']],
          ['/project/src/lib.ts', []],
        ]),
        exported: [mkSymbol(1, '/project/src/lib.ts', 'unusedFn')],
        pkgJson: { main: './src/main.ts' },
      });

      expect(result.deadExports[0]!.span).toEqual(ROW_SPAN);
    });

    it('duplicate-export carries the first surface symbol span', async () => {
      const result = await analyzeWithExports({
        graph: new Map([['/project/src/index.ts', []]]),
        exported: [mkSymbol(1, '/project/src/a.ts', 'helper', 'function'), mkSymbol(2, '/project/src/b.ts', 'helper', 'function')],
        resolveSymbol: resolveSymbolToOrigin('helper', 'src/origin.ts'),
      });

      expect(result.duplicateExports[0]!.span).toEqual(ROW_SPAN);
    });

    it('unused enum member carries the member symbol span', async () => {
      const memberSpan = { start: { line: 7, column: 2 }, end: { line: 7, column: 5 } };
      const result = await analyzeMembers({
        container: mkSymbol(1, '/project/src/colors.ts', 'Color', 'enum'),
        containerFile: '/project/src/colors.ts',
        importName: 'Color',
        calledMembers: ['Color.Red'],
        members: [
          { kind: 'enum', name: 'Color', memberName: null, isExported: true, span: ROW_SPAN },
          { kind: 'property', name: 'Color.Red', memberName: 'Red', isExported: false, span: ROW_SPAN },
          { kind: 'property', name: 'Color.Green', memberName: 'Green', isExported: false, span: memberSpan },
        ],
      });
      const green = result.unusedMembers.find(m => m.memberName === 'Green');

      expect(green?.span).toEqual(memberSpan);
    });
  });
});
