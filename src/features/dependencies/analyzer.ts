import type { Gildash, SymbolDetail } from '@zipbul/gildash';

import { GildashError, normalizePath } from '@zipbul/gildash';
import * as path from 'node:path';

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

import { isConfigLikePath, isTestLikePath } from '../../shared/is-test-like-path';

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

/** Ensure a path from gildash (may be project-relative) is absolute. */
const resolveAbs = (rootAbs: string, p: string): string => normalizePath(path.isAbsolute(p) ? p : path.resolve(rootAbs, p));

/* ------------------------------------------------------------------ */
/*  Layer matching                                                     */
/* ------------------------------------------------------------------ */

interface DependencyLayerRule {
  readonly name: string;
  readonly glob: string;
}

interface AnalyzeDependenciesInput {
  readonly rootAbs?: string;
  readonly layers?: ReadonlyArray<DependencyLayerRule>;
  readonly allowedDependencies?: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly readFileFn?: (path: string) => string;
  /** Workspace package map (name → rootAbs) for monorepo support. When provided, unused/unlisted dep analysis runs per workspace. */
  readonly workspacePackages?: ReadonlyMap<string, string>;
  /** Glob patterns for dependencies to ignore in unused dependency detection. */
  readonly ignoreDependencies?: ReadonlyArray<string>;
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const globToRegExp = (pattern: string): RegExp => {
  const normalized = normalizePath(pattern);
  let out = '^';
  let i = 0;

  while (i < normalized.length) {
    const ch = normalized[i] ?? '';

    if (ch === '*') {
      const next = normalized[i + 1];

      if (next === '*') {
        out += '.*';
        i += 2;

        continue;
      }

      out += '[^/]*';
      i += 1;

      continue;
    }

    if (ch === '?') {
      out += '[^/]';
      i += 1;

      continue;
    }

    out += escapeRegex(ch);
    i += 1;
  }

  out += '$';

  return new RegExp(out);
};

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

const readPackageDependencies = (rootAbs: string, readFn: (p: string) => string): Set<string> => {
  try {
    const raw = readFn(path.join(rootAbs, 'package.json'));
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const deps = new Set<string>();
    const fields = ['dependencies', 'devDependencies'] as const;

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

/** Extract package names referenced in scripts (binary usage like `oxlint`, `knip`, `husky`, etc.). */
const readScriptBinaries = (rootAbs: string, readFn: (p: string) => string): Set<string> => {
  try {
    const raw = readFn(path.join(rootAbs, 'package.json'));
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const scripts = parsed.scripts;
    const bins = new Set<string>();

    if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
      return bins;
    }

    for (const cmd of Object.values(scripts as Record<string, unknown>)) {
      if (typeof cmd !== 'string') {
        continue;
      }

      // Extract first word of each command segment (split on && | ; ||)
      for (const segment of cmd.split(/&&|\|\||[;|]/)) {
        const trimmed = segment.trim();

        // Skip variable assignments and empty segments
        if (trimmed.length === 0 || trimmed.includes('=')) {
          continue;
        }

        const words = trimmed.split(/\s+/);
        // Skip prefix commands like bunx, npx, etc.
        const binary = words[0] === 'bunx' || words[0] === 'npx' ? words[1] : words[0];

        if (binary && binary.length > 0) {
          bins.add(binary);
        }
      }
    }

    return bins;
  } catch {
    return new Set();
  }
};

const readPackageName = (rootAbs: string, readFn: (p: string) => string): string | null => {
  try {
    const raw = readFn(path.join(rootAbs, 'package.json'));
    const parsed = JSON.parse(raw) as Record<string, unknown>;

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
    const raw = readFn(path.join(rootAbs, 'package.json'));
    const parsed = JSON.parse(raw) as Record<string, unknown>;
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

const analyzeDependencies = async (gildash: Gildash, input?: AnalyzeDependenciesInput): Promise<DependencyAnalysis> => {
  const empty = createEmptyDependencies();
  const rootAbs = input?.rootAbs ?? process.cwd();
  const layerMatchers = input?.layers ? compileLayerMatchers(input.layers) : [];
  const readFn = input?.readFileFn ?? ((_p: string) => '{}');
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

  // Normalise gildash paths (may be project-relative) to absolute
  const absGraph = new Map<string, string[]>();

  for (const [from, targets] of graph) {
    absGraph.set(
      resolveAbs(rootAbs, from),
      targets.map(t => resolveAbs(rootAbs, t)),
    );
  }

  // 2. Adjacency & fan metrics
  const adjacencyOut: Record<string, ReadonlyArray<string>> = {};
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();

  for (const [from, targets] of absGraph.entries()) {
    // Dedupe edges: multiple import declarations to the same target count as one edge.
    const uniqueTargets = Array.from(new Set(targets));

    adjacencyOut[toRelativePath(rootAbs, from)] = uniqueTargets.map(t => toRelativePath(rootAbs, t));

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

    cyclePaths = (cycleResult as string[][]).map(p => p.map(e => resolveAbs(rootAbs, e)));
  } catch (e) {
    if (!(e instanceof GildashError)) {
      throw e;
    }
  }

  const cycles = cyclePaths.map(p => ({ path: p.map(entry => toRelativePath(rootAbs, entry)) }));
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
  const exportsByFile = new Map<string, Array<{ name: string; kind: string; detail: SymbolDetail }>>();

  try {
    const allExported = gildash.searchSymbols({ isExported: true });

    for (const sym of allExported) {
      const absFilePath = resolveAbs(rootAbs, sym.filePath);
      const existing = exportsByFile.get(absFilePath) ?? [];

      existing.push({ name: sym.name, kind: sym.kind, detail: sym.detail });
      exportsByFile.set(absFilePath, existing);
    }

    // Also collect re-exported symbols (not in searchSymbols({ isExported: true }))
    const reExportRels = gildash.searchRelations({ type: 're-exports' });

    for (const rel of reExportRels) {
      if (!rel.srcSymbolName || !rel.srcFilePath) {
        continue;
      }

      const absFilePath = resolveAbs(rootAbs, rel.srcFilePath);
      const existing = exportsByFile.get(absFilePath) ?? [];

      // Avoid duplicates
      if (existing.some(s => s.name === rel.srcSymbolName)) {
        continue;
      }

      existing.push({ name: rel.srcSymbolName, kind: 're-export', detail: {} as SymbolDetail });
      exportsByFile.set(absFilePath, existing);
    }

    // `export type { X } from './mod'` → type-references with meta.isReExport: true
    const typeRefRels = gildash.searchRelations({ type: 'type-references' });

    for (const rel of typeRefRels) {
      if (rel.meta?.isReExport !== true || !rel.srcSymbolName || !rel.srcFilePath) {
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

        const existing = nameToEntries.get(sym.name) ?? [];

        existing.push({ relModule: toRelativePath(rootAbs, moduleAbs), absModule: moduleAbs });
        nameToEntries.set(sym.name, existing);
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

        const group = originToModules.get(originKey) ?? [];

        group.push(entry.relModule);
        originToModules.set(originKey, group);
      }

      for (const [, modules] of originToModules) {
        if (modules.length > 1) {
          duplicateExports.push({
            kind: 'duplicate-export',
            name,
            modules,
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
    } catch (e) {
      if (!(e instanceof GildashError)) {
        throw e;
      }
    }

    try {
      typeRefs = gildash.searchRelations({ type: 'type-references' });
    } catch (e) {
      if (!(e instanceof GildashError)) {
        throw e;
      }
    }

    try {
      calls = gildash.searchRelations({ type: 'calls' });
    } catch (e) {
      if (!(e instanceof GildashError)) {
        throw e;
      }
    }

    if (hasImportData) {
      // Build usage map per module
      interface ModuleUsage {
        usesAll: boolean;
        /** symbol name → set of external consumer file paths (self-references excluded) */
        names: Map<string, Set<string>>;
        perNameConsumerKinds: Map<string, Set<'test' | 'prod'>>;
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

        const isTestConsumer = isTestLikePath(consumer);
        const kind: 'test' | 'prod' = isTestConsumer ? 'test' : 'prod';
        const state = usageByModule.get(target) ?? {
          usesAll: false,
          names: new Map<string, Set<string>>(),
          perNameConsumerKinds: new Map<string, Set<'test' | 'prod'>>(),
        };

        // '*' = namespace import (import * as X). re-export with null dstSymbolName = export * from './mod'.
        // Side-effect imports and CJS require() also produce null — skip (not usesAll, not named).
        if (rel.dstSymbolName === '*' || (rel.type === 're-exports' && !rel.dstSymbolName)) {
          state.usesAll = true;
        } else if (rel.dstSymbolName) {
          const consumers = state.names.get(rel.dstSymbolName) ?? new Set<string>();

          consumers.add(consumer);
          state.names.set(rel.dstSymbolName, consumers);

          const prev = state.perNameConsumerKinds.get(rel.dstSymbolName) ?? new Set<'test' | 'prod'>();

          prev.add(kind);
          state.perNameConsumerKinds.set(rel.dstSymbolName, prev);
        }
        // else: null/undefined dstSymbolName on non-re-export → side-effect import, skip

        usageByModule.set(target, state);
      }

      // Entry point reachability via BFS
      // Entry points: package.json fields + test/config/script files in graph
      const graphKeys = new Set(absGraph.keys());
      const entrySpecs = readPackageEntrypoints(rootAbs, readFn);
      const entryModules = new Set<string>();

      for (const spec of entrySpecs) {
        const resolved = resolveEntrypointToFile(rootAbs, spec, graphKeys);

        if (resolved) {
          entryModules.add(resolved);
        }
      }

      // Test files, config files, and scripts are implicit entry points
      for (const fileAbs of graphKeys) {
        if (isTestLikePath(fileAbs) || isConfigLikePath(fileAbs)) {
          entryModules.add(fileAbs);
        }
      }

      const reachable = new Set<string>();
      const queue: string[] = [];

      for (const entry of entryModules) {
        reachable.add(entry);
        queue.push(entry);
      }

      while (queue.length > 0) {
        const current = queue.shift()!;

        for (const next of absGraph.get(current) ?? []) {
          if (!reachable.has(next)) {
            reachable.add(next);
            queue.push(next);
          }
        }
      }

      // Collect unreachable files as unused files (only when entry points are defined)
      const unreachableModules = new Set<string>();

      if (entryModules.size > 0) {
        for (const moduleAbs of graphKeys) {
          if (!reachable.has(moduleAbs) && !isTestLikePath(moduleAbs)) {
            unreachableModules.add(moduleAbs);
            unusedFiles.push({
              kind: 'unused-file',
              module: toRelativePath(rootAbs, moduleAbs),
            });
          }
        }
      }

      // Check each module's exports (skip unreachable — already reported as unused file)
      for (const [moduleAbs, symbols] of exportsByFile) {
        if (symbols.length === 0 || unreachableModules.has(moduleAbs)) {
          continue;
        }

        const usage = usageByModule.get(moduleAbs);

        if (usage?.usesAll) {
          continue;
        }

        const usedNames = usage?.names ?? new Map<string, Set<string>>();
        const perNameConsumerKinds = usage?.perNameConsumerKinds ?? new Map<string, Set<'test' | 'prod'>>();

        for (const sym of symbols) {
          const relModule = toRelativePath(rootAbs, moduleAbs);
          const symConsumers = usedNames.get(sym.name);

          if (symConsumers && symConsumers.size > 0) {
            const kinds = perNameConsumerKinds.get(sym.name) ?? new Set<'test' | 'prod'>();
            const isTestOnly = kinds.size > 0 && !kinds.has('prod');

            if (isTestOnly) {
              deadExports.push({
                kind: 'test-only-export',
                module: relModule,
                name: sym.name,
                symbolKind: sym.kind,
              });
            }

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
      let changed = true;

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

      // Unused enum/namespace members: getSymbolsByFile returns members with memberName.
      // A member is unused if its parent is exported but the member is never referenced
      // in calls relations (e.g. Color.Red, Guards.isString).
      for (const [moduleAbs, symbols] of exportsByFile) {
        const memberParents = symbols.filter(s => s.kind === 'enum' || s.kind === 'namespace');

        if (memberParents.length === 0) {
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
          // Build set of used member names from calls relations targeting this module
          const memberCalls = calls.filter(
            r =>
              r.dstFilePath !== null &&
              resolveAbs(rootAbs, r.dstFilePath) === moduleAbs &&
              r.dstSymbolName !== null &&
              r.dstSymbolName.startsWith(parent.name + '.'),
          );

          // If no calls at all, skip — can't determine member usage without semantic
          if (memberCalls.length === 0) {
            continue;
          }

          const usedMembers = new Set(memberCalls.map(r => r.dstSymbolName!));
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
            module: toRelativePath(rootAbs, rel.srcFilePath),
            specifier: rel.specifier!,
          });

          continue;
        }

        // External package import
        if (rel.isExternal === true) {
          const pkgName = extractPackageName(rel.specifier!);

          if (pkgName && !isBuiltinModule(pkgName)) {
            const files = externalPackages.get(pkgName) ?? new Set<string>();

            files.add(toRelativePath(rootAbs, rel.srcFilePath));
            externalPackages.set(pkgName, files);
          }
        }
      }

      // Compare with package.json dependencies (per workspace or root)
      const ignorePats = (input?.ignoreDependencies ?? []).map(pat => globToRegExp(pat));

      const shouldIgnore = (name: string): boolean => ignorePats.some(re => re.test(name));

      const checkDeps = (depRoot: string, usedPackages: Map<string, Set<string>>): void => {
        const pkgDeps = readPackageDependencies(depRoot, readFn);
        const selfName = readPackageName(depRoot, readFn);
        const scriptBins = readScriptBinaries(depRoot, readFn);

        for (const [pkgName, files] of usedPackages) {
          if (pkgName === selfName || shouldIgnore(pkgName)) {
            continue;
          }

          if (!pkgDeps.has(pkgName)) {
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

          // Skip packages used as CLI binaries in scripts
          if (scriptBins.has(declared)) {
            continue;
          }

          // @types/* — skip if corresponding package is used or is a builtin
          if (declared.startsWith('@types/')) {
            const base = declared.slice('@types/'.length).replace('__', '/');

            if (usedPackages.has(base) || isBuiltinModule(base)) {
              continue;
            }
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
