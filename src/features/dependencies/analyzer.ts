import type { Gildash, SymbolDetail } from '@zipbul/gildash';

import { GildashError, normalizePath } from '@zipbul/gildash';
import * as path from 'node:path';

import type { DependencyLayerRule } from '../../shared/dependency-layer-rule';
import type {
  DependencyAnalysis,
  DependencyDeadExportFinding,
  DependencyEdgeCutHint,
  DependencyFanStat,
  DependencyLayerViolation,
  DependencyUnusedFileFinding,
  DependencyUnusedDepFinding,
  DependencyUnresolvedImportFinding,
  DependencyDuplicateExportFinding,
  DependencyUnusedMemberFinding,
} from '../../types';

import { globToRegExp } from '../../shared/glob-regex';
import { addToSetMap, pushToMultiMap } from '../../shared/multi-map';
import { resolveAbs } from '../../shared/path-resolve';

const sortDependencyFanStats = (items: ReadonlyArray<DependencyFanStat>): ReadonlyArray<DependencyFanStat> => {
  return [...items].sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }

    return left.module.localeCompare(right.module);
  });
};

/* ------------------------------------------------------------------ */
/*  Utilities                                                          */
/* ------------------------------------------------------------------ */

const createEmptyDependencies = (): DependencyAnalysis => ({
  cycles: [],
  adjacency: {},
  exportStats: {},
  fanIn: [],
  fanOut: [],
  cuts: [],
  layerViolations: [],
  deadExports: [],
  unusedFiles: [],
  unusedDeps: [],
  unresolvedImports: [],
  duplicateExports: [],
  unusedMembers: [],
});

const toRelativePath = (rootAbs: string, value: string): string => normalizePath(path.relative(rootAbs, value));

/* ------------------------------------------------------------------ */
/*  Layer matching                                                     */
/* ------------------------------------------------------------------ */

interface AnalyzeDependenciesInput {
  readonly rootAbs?: string;
  readonly layers?: ReadonlyArray<DependencyLayerRule>;
  readonly allowedDependencies?: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly readFileFn?: (path: string) => string;
  /** Workspace package map (name → rootAbs) for monorepo support. When provided, unused/unlisted dep analysis runs per workspace. */
  readonly workspacePackages?: ReadonlyMap<string, string>;
  /** Glob patterns for dependencies to ignore in unused dependency detection. */
  readonly ignoreDependencies?: ReadonlyArray<string>;
  /**
   * Additional entry-point globs (root-relative). Files matching become reachability roots,
   * augmenting the entrypoints auto-detected from package.json. A user-declared FACT.
   */
  readonly entry?: ReadonlyArray<string>;
  /**
   * Globs (root-relative) of files excluded from `unused-file` reporting — the user declares
   * these are not orphans (e.g. framework-loaded files the static graph cannot see). A FACT.
   */
  readonly ignore?: ReadonlyArray<string>;
}

const compileLayerMatchers = (
  layers: ReadonlyArray<DependencyLayerRule>,
): ReadonlyArray<{ readonly layer: DependencyLayerRule; readonly re: RegExp }> => {
  return layers
    .filter(
      layer =>
        typeof layer.name === 'string' &&
        layer.name.trim().length > 0 &&
        typeof layer.glob === 'string' &&
        layer.glob.trim().length > 0,
    )
    .map(layer => ({ layer, re: globToRegExp(layer.glob) }));
};

const matchLayerName = (
  rootAbs: string,
  fileAbs: string,
  matchers: ReadonlyArray<{ readonly layer: DependencyLayerRule; readonly re: RegExp }>,
): string | null => {
  const rel = toRelativePath(rootAbs, fileAbs);

  if (rel.startsWith('..')) {
    return null;
  }

  for (const entry of matchers) {
    if (entry.re.test(rel)) {
      return entry.layer.name;
    }
  }

  return null;
};

/* ------------------------------------------------------------------ */
/*  Package helpers                                                    */
/* ------------------------------------------------------------------ */

/** Extract package name from import specifier (e.g. `lodash/merge` → `lodash`, `@scope/pkg/sub` → `@scope/pkg`). */
const extractPackageName = (specifier: string): string | null => {
  if (specifier.length === 0 || specifier.startsWith('.') || specifier.startsWith('/')) {
    return null;
  }

  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');

    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }

  return specifier.split('/')[0] ?? null;
};

const isBuiltinModule = (name: string): boolean => name === 'bun' || name.startsWith('node:') || name.startsWith('bun:');

/** Read and JSON-parse the package.json under `rootAbs`. Callers wrap this in their own try/catch fallbacks. */
const readPackageJson = (rootAbs: string, readFn: (p: string) => string): Record<string, unknown> =>
  JSON.parse(readFn(path.join(rootAbs, 'package.json'))) as Record<string, unknown>;

const collectDependencyFields = (rootAbs: string, readFn: (p: string) => string, fields: ReadonlyArray<string>): Set<string> => {
  try {
    const parsed = readPackageJson(rootAbs, readFn);
    const deps = new Set<string>();

    for (const field of fields) {
      const section = parsed[field];

      if (section && typeof section === 'object' && !Array.isArray(section)) {
        for (const key of Object.keys(section as Record<string, unknown>)) {
          deps.add(key);
        }
      }
    }

    return deps;
  } catch {
    return new Set();
  }
};

/**
 * Declared runtime/dev dependencies (unused-dependency baseline). peer/optional
 * are excluded: a consumer installs those, so an unused peer/optional is not a W.
 */
const readPackageDependencies = (rootAbs: string, readFn: (p: string) => string): Set<string> =>
  collectDependencyFields(rootAbs, readFn, ['dependencies', 'devDependencies']);

/**
 * Every declared dependency field (unlisted-dependency baseline). npm semantics:
 * a package declared under any of dependencies/devDependencies/peerDependencies/
 * optionalDependencies is "declared" and must not be flagged as unlisted.
 */
const readDeclaredPackages = (rootAbs: string, readFn: (p: string) => string): Set<string> =>
  collectDependencyFields(rootAbs, readFn, ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']);

/**
 * Whether a declared dep exposes a binary via its installed package.json `bin` field — a
 * declared contract (fact). Tri-state, because install layout is NOT a fact firebat controls:
 *   - `'bin'`     manifest read and has a non-empty `bin` → executable package.
 *   - `'no-bin'`  manifest read and has no/empty `bin`    → pure library.
 *   - `'unknown'` no manifest readable in the walk        → install-state cannot confirm.
 *
 * An executable package can be invoked by a script, a git hook, `bunx`, or a human — none of
 * which the static import graph observes — so a `'bin'` dep's non-use cannot be proven. We do
 * NOT parse scripts to guess "is it the executed binary": shell grammar (env prefixes,
 * `cross-env`, subshells, path/`.bin` invocation, wrappers) does not close, and every missed
 * form would be a false W. Bin-existence is the closed fact that supersedes it.
 *
 * `'unknown'` MUST be treated like `'bin'` (hold): pnpm's non-flat store, Yarn PnP (no
 * `node_modules` at all), and monorepo hoisting above `rootAbs` all leave the manifest
 * unreadable here while the dep genuinely ships a binary. Reporting on absence-of-manifest
 * would smuggle install-state in as evidence for a W — forbidden. Per "닫히지 않으면 보류",
 * unknown → hold (FN). The manifest is resolved from the workspace dir up to the project root.
 */
const readDepBinState = (
  depRoot: string,
  rootAbs: string,
  dep: string,
  readFn: (p: string) => string,
): 'bin' | 'no-bin' | 'unknown' => {
  let dir = depRoot;

  for (;;) {
    try {
      const bin = readPackageJson(path.join(dir, 'node_modules', dep), readFn).bin;
      const hasBin =
        typeof bin === 'string'
          ? bin.length > 0
          : Boolean(bin) && typeof bin === 'object' && !Array.isArray(bin) && Object.keys(bin as object).length > 0;

      return hasBin ? 'bin' : 'no-bin';
    } catch {
      if (dir === rootAbs) {
        return 'unknown';
      }

      const parent = path.dirname(dir);

      // Walk toward the project root (clamped) so npm-hoisted manifests are still found.
      dir = parent.length < rootAbs.length ? rootAbs : parent;
    }
  }
};

const readPackageName = (rootAbs: string, readFn: (p: string) => string): string | null => {
  try {
    const parsed = readPackageJson(rootAbs, readFn);

    return typeof parsed.name === 'string' ? parsed.name : null;
  } catch {
    return null;
  }
};

/* ------------------------------------------------------------------ */
/*  Path helpers                                                       */
/* ------------------------------------------------------------------ */

const readPackageEntrypoints = (rootAbs: string, readFn: (p: string) => string): ReadonlyArray<string> => {
  try {
    const parsed = readPackageJson(rootAbs, readFn);
    const out: string[] = [];

    const collectStrings = (node: unknown): void => {
      if (typeof node === 'string') {
        out.push(node);

        return;
      }

      if (!node || typeof node !== 'object') {
        return;
      }

      if (Array.isArray(node)) {
        for (const entry of node) {
          collectStrings(entry);
        }

        return;
      }

      for (const value of Object.values(node as Record<string, unknown>)) {
        collectStrings(value);
      }
    };

    const scalarFields = ['main', 'module', 'browser', 'types', 'typings'] as const;

    for (const field of scalarFields) {
      if (typeof parsed[field] === 'string') {
        out.push(parsed[field] as string);
      }
    }

    collectStrings(parsed.bin);
    collectStrings(parsed.exports);

    return out;
  } catch {
    return [];
  }
};

const resolveEntrypointToFile = (rootAbs: string, spec: string, graphKeys: ReadonlySet<string>): string | null => {
  if (typeof spec !== 'string' || spec.trim().length === 0) {
    return null;
  }

  const trimmed = spec.trim();
  const rel = trimmed.startsWith('.') ? trimmed : `./${trimmed}`;
  const abs = path.resolve(rootAbs, rel);
  const candidates = [abs, `${abs}.ts`, path.join(abs, 'index.ts')];

  for (const candidate of candidates) {
    const normalized = normalizePath(candidate);

    if (graphKeys.has(normalized)) {
      return normalized;
    }
  }

  return null;
};

/* ------------------------------------------------------------------ */
/*  Fan stats & edge cut hints                                         */
/* ------------------------------------------------------------------ */

const listFanStats = (rootAbs: string, counts: Map<string, number>, limit: number): ReadonlyArray<DependencyFanStat> => {
  const items = Array.from(counts.entries())
    .filter(([, count]) => count > 0)
    .map(([module, count]) => ({ module: toRelativePath(rootAbs, module), count }));

  return sortDependencyFanStats(items).slice(0, limit);
};

const buildEdgeCutHints = (
  rootAbs: string,
  cycles: ReadonlyArray<ReadonlyArray<string>>,
  outDegree: Map<string, number>,
): ReadonlyArray<DependencyEdgeCutHint> => {
  const seen = new Set<string>();
  const hints: DependencyEdgeCutHint[] = [];

  for (const cycle of cycles) {
    if (cycle.length < 2) {
      continue;
    }

    let bestIndex = 0;
    let bestScore = -1;

    for (let index = 0; index < cycle.length - 1; index += 1) {
      const from = cycle[index] ?? '';
      const score = outDegree.get(from) ?? 0;

      if (score <= bestScore) {
        continue;
      }

      bestScore = score;
      bestIndex = index;
    }

    const from = cycle[bestIndex] ?? '';
    const to = cycle[bestIndex + 1] ?? '';
    const key = `${from}=>${to}`;

    if (from.length === 0 || to.length === 0 || seen.has(key)) {
      continue;
    }

    seen.add(key);
    hints.push({
      from: toRelativePath(rootAbs, from),
      to: toRelativePath(rootAbs, to),
      score: bestScore > 0 ? bestScore : 1,
    });
  }

  return hints;
};

/* ------------------------------------------------------------------ */
/*  Main analysis function                                             */
/* ------------------------------------------------------------------ */

interface ExportEntry {
  name: string;
  kind: string;
  detail: SymbolDetail;
}

type Relation = ReturnType<Gildash['searchRelations']>[number];

/**
 * Collect re-export entries from `rels` into `exportsByFile`: for each relation
 * passing `shouldInclude` (and carrying a src symbol/file), add a re-export entry
 * keyed by its absolute file, skipping names already recorded for that file.
 * Single change-point for the two re-export collection passes (re-exports + type re-exports).
 */
const collectReExportEntries = (
  exportsByFile: Map<string, ExportEntry[]>,
  rootAbs: string,
  rels: ReadonlyArray<Relation>,
  shouldInclude?: (rel: Relation) => boolean,
): void => {
  for (const rel of rels) {
    if ((shouldInclude !== undefined && !shouldInclude(rel)) || !rel.srcSymbolName || !rel.srcFilePath) {
      continue;
    }

    const absFilePath = resolveAbs(rootAbs, rel.srcFilePath);
    const existing = exportsByFile.get(absFilePath) ?? [];

    if (existing.some(s => s.name === rel.srcSymbolName)) {
      continue;
    }

    existing.push({ name: rel.srcSymbolName, kind: 're-export', detail: {} as SymbolDetail });
    exportsByFile.set(absFilePath, existing);
  }
};

const analyzeDependencies = async (gildash: Gildash, input?: AnalyzeDependenciesInput): Promise<DependencyAnalysis> => {
  const empty = createEmptyDependencies();
  const rootAbs = input?.rootAbs ?? process.cwd();
  const layerMatchers = input?.layers ? compileLayerMatchers(input.layers) : [];
  const readFn =
    input?.readFileFn ??
    ((p: string): string => {
      // No fs access provided — behave like a missing file (real-FS semantics),
      // NOT like an empty manifest: '{}' would make EVERY directory parse as a
      // package boundary and hold all dead-export verdicts.
      throw new Error(`ENOENT (no readFileFn): ${p}`);
    });
  // 1. Import graph
  let graph: Map<string, string[]>;

  try {
    graph = await gildash.getImportGraph();
  } catch (e) {
    if (!(e instanceof GildashError)) {
      throw e;
    }

    return empty;
  }

  // rootAbs에 고정한 경로 변환 — 같은 부분적용이 여러 map에 흩어지지 않도록 한곳에 둔다.
  const toAbs = (value: string) => resolveAbs(rootAbs, value);

  const toRel = (value: string) => toRelativePath(rootAbs, value);

  // Normalise gildash paths (may be project-relative) to absolute
  const absGraph = new Map<string, string[]>();

  for (const [from, targets] of graph) {
    absGraph.set(resolveAbs(rootAbs, from), targets.map(toAbs));
  }

  // 2. Adjacency & fan metrics
  const adjacencyOut: Record<string, ReadonlyArray<string>> = {};
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();

  for (const [from, targets] of absGraph.entries()) {
    // Dedupe edges: multiple import declarations to the same target count as one edge.
    const uniqueTargets = Array.from(new Set(targets));

    adjacencyOut[toRelativePath(rootAbs, from)] = uniqueTargets.map(toRel);

    outDegree.set(from, uniqueTargets.length);

    if (!inDegree.has(from)) {
      inDegree.set(from, 0);
    }

    for (const target of uniqueTargets) {
      const prev = inDegree.get(target) ?? 0;

      inDegree.set(target, prev + 1);
    }
  }

  const fanIn = listFanStats(rootAbs, inDegree, 10);
  const fanOut = listFanStats(rootAbs, outDegree, 10);
  // 3. Cycles via gildash (Tarjan SCC + Johnson's circuits)
  let cyclePaths: ReadonlyArray<ReadonlyArray<string>> = [];

  try {
    const cycleResult = await gildash.getCyclePaths(undefined, { maxCycles: 100 });

    cyclePaths = (cycleResult as string[][]).map(p => p.map(toAbs));
  } catch (e) {
    if (!(e instanceof GildashError)) {
      throw e;
    }
  }

  const cycles = cyclePaths.map(p => ({ path: p.map(toRel) }));
  const cuts = buildEdgeCutHints(rootAbs, cyclePaths, outDegree);
  // 4. Layer violations
  const layerViolations: DependencyLayerViolation[] = [];

  if (layerMatchers.length > 0) {
    const allowedDependencies = input?.allowedDependencies ?? {};

    for (const [from, targets] of absGraph.entries()) {
      const fromLayer = matchLayerName(rootAbs, from, layerMatchers);

      if (!fromLayer) {
        continue;
      }

      const allowed = allowedDependencies[fromLayer] ?? [];

      for (const target of targets) {
        const toLayer = matchLayerName(rootAbs, target, layerMatchers);

        if (!toLayer || fromLayer === toLayer || allowed.includes(toLayer)) {
          continue;
        }

        layerViolations.push({
          kind: 'layer-violation',
          message: `${fromLayer} → ${toLayer} dependency not permitted`,
          from: toRelativePath(rootAbs, from),
          to: toRelativePath(rootAbs, target),
          fromLayer,
          toLayer,
        });
      }
    }
  }

  // 5. Export stats via searchSymbols
  const exportStats: Record<string, { readonly total: number; readonly abstract: number }> = {};
  const exportsByFile = new Map<string, ExportEntry[]>();

  try {
    const allExported = gildash.searchSymbols({ isExported: true });

    for (const sym of allExported) {
      const absFilePath = resolveAbs(rootAbs, sym.filePath);

      pushToMultiMap(exportsByFile, absFilePath, { name: sym.name, kind: sym.kind, detail: sym.detail });
    }

    // Also collect re-exported symbols (not in searchSymbols({ isExported: true }))
    collectReExportEntries(exportsByFile, rootAbs, gildash.searchRelations({ type: 're-exports' }));

    // `export type { X } from './mod'` → type-references with meta.isReExport: true
    collectReExportEntries(
      exportsByFile,
      rootAbs,
      gildash.searchRelations({ type: 'type-references' }),
      rel => rel.meta?.isReExport === true,
    );

    for (const [filePath, symbols] of exportsByFile) {
      const total = symbols.length;
      const abstract = symbols.filter(
        s =>
          s.kind === 'interface' ||
          s.kind === 'type' ||
          (s.kind === 'class' && s.detail.modifiers?.includes('abstract') === true),
      ).length;

      exportStats[toRelativePath(rootAbs, filePath)] = { total, abstract };
    }
  } catch (e) {
    if (!(e instanceof GildashError)) {
      throw e;
    }
  }

  // 6. Duplicate export detection (same origin via resolveSymbol)
  const duplicateExports: DependencyDuplicateExportFinding[] = [];

  if (exportsByFile.size > 0) {
    // Group exports by name across all files
    const nameToEntries = new Map<string, Array<{ relModule: string; absModule: string }>>();

    for (const [moduleAbs, symbols] of exportsByFile) {
      for (const sym of symbols) {
        // Skip re-exports for duplicate detection — they're not independent definitions
        if (sym.kind === 're-export') {
          continue;
        }

        pushToMultiMap(nameToEntries, sym.name, { relModule: toRelativePath(rootAbs, moduleAbs), absModule: moduleAbs });
      }
    }

    for (const [name, entries] of nameToEntries) {
      if (entries.length < 2) {
        continue;
      }

      // Use resolveSymbol to group by original source
      const originToModules = new Map<string, string[]>();

      for (const entry of entries) {
        let originKey: string;

        try {
          const resolved = gildash.resolveSymbol(name, toRelativePath(rootAbs, entry.absModule));

          originKey = `${resolved.originalFilePath}::${resolved.originalName}`;
        } catch {
          // resolveSymbol failed — use the module itself as origin
          originKey = `${entry.relModule}::${name}`;
        }

        pushToMultiMap(originToModules, originKey, entry.relModule);
      }

      for (const [, modules] of originToModules) {
        // A "surface" is a module: overload signatures (or any repeated declarations)
        // within ONE file are a single surface, not duplication — dedupe by module
        // and require 2+ DISTINCT modules (spec: "2개 이상의 표면에 중복 노출").
        const distinctModules = [...new Set(modules)];

        if (distinctModules.length > 1) {
          duplicateExports.push({
            kind: 'duplicate-export',
            name,
            modules: distinctModules,
          });
        }
      }
    }
  }

  // 7. Dead export + unused file + unused dep + unresolved import + unused member detection
  const deadExports: DependencyDeadExportFinding[] = [];
  const unusedFiles: DependencyUnusedFileFinding[] = [];
  const unusedDeps: DependencyUnusedDepFinding[] = [];
  const unresolvedImports: DependencyUnresolvedImportFinding[] = [];
  const unusedMembers: DependencyUnusedMemberFinding[] = [];

  {
    let imports: ReturnType<Gildash['searchRelations']> = [];
    let reExports: ReturnType<Gildash['searchRelations']> = [];
    let typeRefs: ReturnType<Gildash['searchRelations']> = [];
    let calls: ReturnType<Gildash['searchRelations']> = [];
    let hasImportData = false;
    // Relation-completeness gates (spec: 전체-인덱싱 전제). dead-export·member
    // judgments require imports + re-exports + type-references + calls to all
    // index successfully; if any relation query degrades (GildashError), those
    // "usage = 0" verdicts are held (보류) to avoid FPs from missing edges.
    let hasReExportData = false;
    let hasTypeRefData = false;
    let hasCallData = false;

    try {
      imports = gildash.searchRelations({ type: 'imports' });
      hasImportData = true;
    } catch (e) {
      if (!(e instanceof GildashError)) {
        throw e;
      }
    }

    try {
      reExports = gildash.searchRelations({ type: 're-exports' });
      hasReExportData = true;
    } catch (e) {
      if (!(e instanceof GildashError)) {
        throw e;
      }
    }

    try {
      typeRefs = gildash.searchRelations({ type: 'type-references' });
      hasTypeRefData = true;
    } catch (e) {
      if (!(e instanceof GildashError)) {
        throw e;
      }
    }

    try {
      calls = gildash.searchRelations({ type: 'calls' });
      hasCallData = true;
    } catch (e) {
      if (!(e instanceof GildashError)) {
        throw e;
      }
    }

    // dead-export / unused-enum|ns-member are only sound when
    // the full relation index is available. Missing any relation → hold verdicts.
    const relationsComplete = hasReExportData && hasTypeRefData && hasCallData;

    if (hasImportData) {
      // Build usage map per module
      interface ModuleUsage {
        usesAll: boolean;
        /** symbol name → set of external consumer file paths (self-references excluded) */
        names: Map<string, Set<string>>;
      }

      const usageByModule = new Map<string, ModuleUsage>();

      for (const rel of [...imports, ...reExports, ...typeRefs, ...calls]) {
        if (rel.dstFilePath === null) {
          continue;
        }

        const target = resolveAbs(rootAbs, rel.dstFilePath);
        const consumer = resolveAbs(rootAbs, rel.srcFilePath);

        // Self-reference (same file calls/references itself) — not external usage
        if (target === consumer) {
          continue;
        }

        const state = usageByModule.get(target) ?? {
          usesAll: false,
          names: new Map<string, Set<string>>(),
        };

        // '*' = namespace import (import * as X). re-export with null dstSymbolName = export * from './mod'.
        // Side-effect imports and CJS require() also produce null — skip (not usesAll, not named).
        if (rel.dstSymbolName === '*' || (rel.type === 're-exports' && !rel.dstSymbolName)) {
          state.usesAll = true;
        } else if (rel.dstSymbolName) {
          addToSetMap(state.names, rel.dstSymbolName, consumer);
        }
        // else: null/undefined dstSymbolName on non-re-export → side-effect import, skip

        usageByModule.set(target, state);
      }

      // Entry point reachability via BFS
      // Entry points: package.json fields + test/config/script files in graph.
      // Monorepos: every nested package manifest is a package boundary whose
      // entrypoints are consumed by EXTERNAL package consumers — a sub-package's
      // entry file is not "unused" just because the root manifest doesn't point
      // at it. Collect manifests from every ancestor dir of graph files.
      const graphKeys = new Set(absGraph.keys());
      const entryModules = new Set<string>();
      const manifestDirs = new Set<string>([rootAbs]);

      for (const fileAbs of graphKeys) {
        let dir = path.dirname(fileAbs);

        while (dir.startsWith(rootAbs) && dir.length >= rootAbs.length) {
          manifestDirs.add(dir);

          const parent = path.dirname(dir);

          if (parent === dir) {
            break;
          }

          dir = parent;
        }
      }

      const nestedPkgDirs: string[] = [];

      for (const dir of manifestDirs) {
        // Package boundary = a parseable manifest EXISTS — apps (Next 등) often have
        // no main/exports fields but are still externally-driven package roots.
        try {
          readPackageJson(dir, readFn);
        } catch {
          continue;
        }

        if (dir !== rootAbs) {
          nestedPkgDirs.push(`${dir}/`);
        }

        for (const spec of readPackageEntrypoints(dir, readFn)) {
          const resolved = resolveEntrypointToFile(dir, spec, graphKeys);

          if (resolved) {
            entryModules.add(resolved);
          }
        }
      }

      // Files under a NESTED package boundary are consumed by external package
      // consumers (outside the indexed graph) — unused-file cannot be proven for
      // them from this graph, so the verdict is held (spec: 전체-인덱싱 전제).
      const isUnderNestedPackage = (fileAbs: string): boolean => nestedPkgDirs.some(d => fileAbs.startsWith(d));

      // Reachability roots come ONLY from declared facts: package.json entrypoints (above) and
      // user-declared `entry` globs. No filename-convention inference (that is a guess-value).
      const userEntryGlobs = input?.entry ?? [];
      const entryMatchers = userEntryGlobs.map(globToRegExp);

      if (entryMatchers.length > 0) {
        for (const fileAbs of graphKeys) {
          if (entryMatchers.some(re => re.test(toRel(fileAbs)))) {
            entryModules.add(fileAbs);
          }
        }
      }

      // User-declared `ignore` globs (root-relative) — files excluded from unused-file reporting.
      const ignoreMatchers = (input?.ignore ?? []).map(globToRegExp);

      const reachable = new Set<string>();
      const queue: string[] = [];

      const enqueueReachable = (moduleAbs: string): void => {
        reachable.add(moduleAbs);
        queue.push(moduleAbs);
      };

      for (const entry of entryModules) {
        enqueueReachable(entry);
      }

      while (queue.length > 0) {
        const current = queue.shift()!;

        for (const next of absGraph.get(current) ?? []) {
          if (!reachable.has(next)) {
            enqueueReachable(next);
          }
        }
      }

      // unused-file is OPT-IN: emit only when the user declared `entry` — their assertion that
      // the entry set is complete. Without it, completeness is unproven (a test/config file
      // unreachable from package.json is not necessarily dead) → HOLD (FN direction, never a
      // false-positive flood). package.json entrypoints still seed reachability above.
      const unreachableModules = new Set<string>();
      const userDeclaredEntry = userEntryGlobs.length > 0;

      // Populate `unreachableModules` whenever reachability is computable (entry roots exist) so
      // the dead-export pass below can dedup (a file-level orphan must not also surface as
      // per-symbol dead-export). But EMIT `unused-file` only when the user opted in via `entry`
      // (their assertion the entry set is complete) — otherwise HOLD (FN, never a false flood).
      if (entryModules.size > 0) {
        for (const moduleAbs of graphKeys) {
          if (
            !reachable.has(moduleAbs) &&
            !isUnderNestedPackage(moduleAbs) &&
            !ignoreMatchers.some(re => re.test(toRel(moduleAbs)))
          ) {
            unreachableModules.add(moduleAbs);

            if (userDeclaredEntry) {
              unusedFiles.push({
                kind: 'unused-file',
                module: toRelativePath(rootAbs, moduleAbs),
              });
            }
          }
        }
      }

      // Check each module's exports (skip unreachable — already reported as unused file).
      // Held entirely when the relation index is incomplete (spec: 전체-인덱싱 전제).
      for (const [moduleAbs, symbols] of relationsComplete ? exportsByFile : []) {
        // Nested-package files: their symbol consumers are external package
        // consumers (outside the indexed graph) — hold dead-export verdicts.
        if (symbols.length === 0 || unreachableModules.has(moduleAbs) || isUnderNestedPackage(moduleAbs)) {
          continue;
        }

        const usage = usageByModule.get(moduleAbs);

        if (usage?.usesAll) {
          continue;
        }

        const usedNames = usage?.names ?? new Map<string, Set<string>>();

        for (const sym of symbols) {
          const relModule = toRelativePath(rootAbs, moduleAbs);
          const symConsumers = usedNames.get(sym.name);

          // Has at least one consumer (test, prod, or otherwise) → not dead. Whether a
          // consumer "counts" as production use is not decidable from a filename fact, so
          // no test-only refinement is made (would require a guess-value).
          if (symConsumers && symConsumers.size > 0) {
            continue;
          }

          deadExports.push({
            kind: 'dead-export',
            module: relModule,
            name: sym.name,
            symbolKind: sym.kind,
          });
        }
      }

      // 2nd pass: propagate dead re-exports upward.
      // If an export's only consumers are files whose re-export of the same symbol is dead,
      // then the original export is also dead.
      const deadSet = new Set(deadExports.map(d => `${resolveAbs(rootAbs, d.module)}::${d.name}`));
      let changed = relationsComplete;

      while (changed) {
        changed = false;

        for (const [moduleAbs, symbols] of exportsByFile) {
          if (unreachableModules.has(moduleAbs)) {
            continue;
          }

          const usage = usageByModule.get(moduleAbs);

          if (usage?.usesAll) {
            continue;
          }

          const usedNames = usage?.names ?? new Map<string, Set<string>>();

          for (const sym of symbols) {
            const key = `${moduleAbs}::${sym.name}`;

            if (deadSet.has(key)) {
              continue;
            }

            const consumers = usedNames.get(sym.name);

            if (!consumers || consumers.size === 0) {
              continue;
            }

            // Check if ALL consumers are dead re-exporters of this symbol
            const allConsumersDead = [...consumers].every(consumerAbs => {
              const consumerExports = exportsByFile.get(consumerAbs);
              const isReExporter = consumerExports?.some(s => s.name === sym.name && s.kind === 're-export');

              return isReExporter === true && deadSet.has(`${consumerAbs}::${sym.name}`);
            });

            if (allConsumersDead) {
              deadSet.add(key);
              deadExports.push({
                kind: 'dead-export',
                module: toRelativePath(rootAbs, moduleAbs),
                name: sym.name,
                symbolKind: sym.kind,
              });

              changed = true;
            }
          }
        }
      }

      // Named-import attribution index: consumerFileAbs → importedName → set of
      // source module abs it was imported from. Lets a cross-file qualified call
      // (`Guards.isNumber()` recorded on the consumer file) be attributed back to
      // the parent's defining module via the consumer's `import { Guards }`.
      const importedNameFrom = new Map<string, Map<string, Set<string>>>();

      for (const rel of imports) {
        if (rel.dstFilePath === null || !rel.dstSymbolName || rel.dstSymbolName === '*') {
          continue;
        }

        const consumerAbs = resolveAbs(rootAbs, rel.srcFilePath);
        const targetAbs = resolveAbs(rootAbs, rel.dstFilePath);
        const byName = importedNameFrom.get(consumerAbs) ?? new Map<string, Set<string>>();

        addToSetMap(byName, rel.dstSymbolName, targetAbs);
        importedNameFrom.set(consumerAbs, byName);
      }

      // Unused enum/namespace members: getSymbolsByFile returns members with memberName.
      // A member is unused if its parent is exported but the member is never referenced
      // in calls relations (e.g. Color.Red, Guards.isString).
      for (const [moduleAbs, symbols] of relationsComplete ? exportsByFile : []) {
        const memberParents = symbols.filter(s => s.kind === 'enum' || s.kind === 'namespace');

        // Same external-consumer hold as dead-export for nested-package files.
        if (memberParents.length === 0 || isUnderNestedPackage(moduleAbs)) {
          continue;
        }

        const relModule = toRelativePath(rootAbs, moduleAbs);
        // Get all symbols in this file (including non-exported members)
        let fileSymbols: ReturnType<Gildash['getSymbolsByFile']>;

        try {
          fileSymbols = gildash.getSymbolsByFile(relModule);
        } catch {
          continue;
        }

        for (const parent of memberParents) {
          // Find members: memberName != null, name starts with ParentName.
          const members = fileSymbols.filter(s => s.memberName !== null && s.name.startsWith(parent.name + '.'));
          const prefix = parent.name + '.';
          // Collect every qualified call to `Parent.member`, attributing it to this
          // parent module. A call is attributed when either (a) it is recorded on
          // the parent module itself (in-file qualified call), or (b) it is recorded
          // on a consumer file that named-imported `Parent` from this module.
          const attributedCalls: string[] = [];
          let attributionUnresolved = false;

          for (const r of calls) {
            if (r.dstFilePath === null || r.dstSymbolName === null || !r.dstSymbolName.startsWith(prefix)) {
              continue;
            }

            const callFileAbs = resolveAbs(rootAbs, r.dstFilePath);

            if (callFileAbs === moduleAbs) {
              attributedCalls.push(r.dstSymbolName);

              continue;
            }

            const importsHere = importedNameFrom.get(callFileAbs)?.get(parent.name);

            if (importsHere?.has(moduleAbs) === true) {
              attributedCalls.push(r.dstSymbolName);
            } else {
              // A qualified call to this parent name that cannot be attributed to
              // this module — attribution not closed, so hold the whole parent's
              // member verdict (conservative K) to avoid flagging used members.
              attributionUnresolved = true;
            }
          }

          // If attribution is not closed, hold this parent's judgment.
          if (attributionUnresolved) {
            continue;
          }

          // If no calls at all, skip — can't determine member usage without semantic
          if (attributedCalls.length === 0) {
            continue;
          }

          const usedMembers = new Set(attributedCalls);
          // usesAll → skip
          const moduleUsage = usageByModule.get(moduleAbs);

          if (moduleUsage?.usesAll) {
            continue;
          }

          for (const member of members) {
            if (!usedMembers.has(`${parent.name}.${member.memberName}`)) {
              const findingKind: DependencyUnusedMemberFinding['kind'] =
                parent.kind === 'enum' ? 'unused-enum-member' : 'unused-ns-member';

              unusedMembers.push({
                kind: findingKind,
                module: relModule,
                symbolName: parent.name,
                memberName: member.memberName!,
              });
            }
          }
        }
      }

      // Phase 2: unused/unlisted dependencies + unresolved imports
      const externalPackages = new Map<string, Set<string>>();

      for (const rel of imports) {
        // gildash 0.28 contract: `specifier` is always present on 'imports' relations.
        // Unresolved internal import
        if (rel.isExternal === false && rel.dstFilePath === null) {
          unresolvedImports.push({
            kind: 'unresolved-import',
            module: toRel(resolveAbs(rootAbs, rel.srcFilePath)),
            specifier: rel.specifier!,
          });

          continue;
        }

        // External package import
        if (rel.isExternal === true) {
          const pkgName = extractPackageName(rel.specifier!);

          if (pkgName && !isBuiltinModule(pkgName)) {
            addToSetMap(externalPackages, pkgName, toRel(resolveAbs(rootAbs, rel.srcFilePath)));
          }
        }
      }

      // Unresolved re-export: `export … from './missing'` is the same "internal
      // reference not resolving to a file" concept as an unresolved import
      // (dstFilePath === null on a non-external re-export with a module specifier).
      const seenUnresolved = new Set(unresolvedImports.map(u => `${u.module}::${u.specifier}`));

      for (const rel of reExports) {
        if (rel.isExternal === true || rel.dstFilePath !== null || !rel.specifier || !rel.srcFilePath) {
          continue;
        }

        const module = toRel(resolveAbs(rootAbs, rel.srcFilePath));
        const key = `${module}::${rel.specifier}`;

        if (seenUnresolved.has(key)) {
          continue;
        }

        seenUnresolved.add(key);
        unresolvedImports.push({ kind: 'unresolved-import', module, specifier: rel.specifier });
      }

      // Compare with package.json dependencies (per workspace or root)
      const ignorePats = (input?.ignoreDependencies ?? []).map(pat => globToRegExp(pat));

      const shouldIgnore = (name: string): boolean => ignorePats.some(re => re.test(name));

      const checkDeps = (depRoot: string, usedPackages: Map<string, Set<string>>): void => {
        const pkgDeps = readPackageDependencies(depRoot, readFn);
        const declaredPkgs = readDeclaredPackages(depRoot, readFn);
        const selfName = readPackageName(depRoot, readFn);

        for (const [pkgName, files] of usedPackages) {
          if (pkgName === selfName || shouldIgnore(pkgName)) {
            continue;
          }

          if (!declaredPkgs.has(pkgName)) {
            unusedDeps.push({
              kind: 'unlisted-dependency',
              packageName: pkgName,
              files: [...files],
            });
          }
        }

        for (const declared of pkgDeps) {
          if (declared === selfName || shouldIgnore(declared)) {
            continue;
          }

          if (usedPackages.has(declared)) {
            continue;
          }

          // @types/* deadness does not close from a single leaf manifest — the ambient/global
          // inclusion of a type package depends on tsconfig `types`/`typeRoots`, `extends`,
          // `references`, and triple-slash `/// <reference types>` directives (un-mergeable here),
          // and ambient-global packages (@types/node, @types/jest) are consumed with no import at
          // all. Per "닫히지 않으면 보류", hold every @types/* (FN) rather than risk a false W.
          if (declared.startsWith('@types/')) {
            continue;
          }

          // A bin-providing dep is invocable outside the static graph (scripts, hooks, bunx,
          // manual) → non-use not provable → hold. `'unknown'` (manifest unreadable: pnpm/PnP/
          // hoist-above-root) also holds — absence of install-state is not evidence of no-bin.
          // Only a confirmed no-bin, unimported dep is reported.
          if (readDepBinState(depRoot, rootAbs, declared, readFn) !== 'no-bin') {
            continue;
          }

          unusedDeps.push({
            kind: 'unused-dependency',
            packageName: declared,
            files: [],
          });
        }
      };

      const workspaces = input?.workspacePackages;

      if (workspaces && workspaces.size > 0) {
        // Per-workspace analysis: group external imports by workspace
        for (const [, wsRoot] of workspaces) {
          const wsRel = toRelativePath(rootAbs, wsRoot);
          const wsPackages = new Map<string, Set<string>>();

          for (const [pkgName, files] of externalPackages) {
            const wsFiles = new Set<string>();

            for (const f of files) {
              if (f.startsWith(wsRel + '/') || f === wsRel) {
                wsFiles.add(f);
              }
            }

            if (wsFiles.size > 0) {
              wsPackages.set(pkgName, wsFiles);
            }
          }

          checkDeps(wsRoot, wsPackages);
        }
      } else {
        checkDeps(rootAbs, externalPackages);
      }
    }
  }

  return {
    cycles,
    adjacency: adjacencyOut,
    exportStats,
    fanIn,
    fanOut,
    cuts,
    layerViolations,
    deadExports,
    unusedFiles,
    unusedDeps,
    unresolvedImports,
    duplicateExports,
    unusedMembers,
  };
};

export { analyzeDependencies, createEmptyDependencies };
