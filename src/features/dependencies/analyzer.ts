import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import type { Gildash } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';

import type {
  DependencyAnalysis,
  DependencyDeadExportFinding,
  DependencyEdgeCutHint,
  DependencyFanStat,
  DependencyLayerViolation,
} from '../../types';

import { sortDependencyFanStats } from '../../engine/sort-utils';

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
});

const normalizePath = (value: string): string => value.replaceAll('\\', '/');

const toRelativePath = (rootAbs: string, value: string): string => normalizePath(path.relative(rootAbs, value));

/** Ensure a path from gildash (may be project-relative) is absolute. */
const resolveAbs = (rootAbs: string, p: string): string =>
  normalizePath(path.isAbsolute(p) ? p : path.resolve(rootAbs, p));

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
/*  Path helpers                                                       */
/* ------------------------------------------------------------------ */

const isTestLikePath = (value: string): boolean => {
  const normalized = normalizePath(value);

  return (
    normalized.includes('/test/') ||
    normalized.includes('/tests/') ||
    normalized.endsWith('.test.ts') ||
    normalized.endsWith('.spec.ts')
  );
};

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

      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
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

const analyzeDependencies = async (
  gildash: Gildash,
  input?: AnalyzeDependenciesInput,
): Promise<DependencyAnalysis> => {
  const empty = createEmptyDependencies();
  const rootAbs = input?.rootAbs ?? process.cwd();
  const layerMatchers = input?.layers ? compileLayerMatchers(input.layers) : [];
  const allowedDependencies = input?.allowedDependencies ?? {};
  const readFn = input?.readFileFn ?? ((p: string) => readFileSync(p, 'utf8'));

  // 1. Import graph
  const graphResult = await gildash.getImportGraph();

  if (isErr(graphResult)) {
    return empty;
  }

  const graph: Map<string, string[]> = graphResult;

  // Normalise gildash paths (may be project-relative) to absolute
  const absGraph = new Map<string, string[]>();

  for (const [from, targets] of graph) {
    absGraph.set(resolveAbs(rootAbs, from), targets.map(t => resolveAbs(rootAbs, t)));
  }

  // 2. Adjacency & fan metrics
  const adjacencyOut: Record<string, ReadonlyArray<string>> = {};
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();

  for (const [from, targets] of absGraph.entries()) {
    adjacencyOut[toRelativePath(rootAbs, from)] = targets.map(t => toRelativePath(rootAbs, t));

    outDegree.set(from, targets.length);

    if (!inDegree.has(from)) {
      inDegree.set(from, 0);
    }

    for (const target of targets) {
      const prev = inDegree.get(target) ?? 0;

      inDegree.set(target, prev + 1);
    }
  }

  const fanIn = listFanStats(rootAbs, inDegree, 10);
  const fanOut = listFanStats(rootAbs, outDegree, 10);

  // 3. Cycles via gildash (Tarjan SCC + Johnson's circuits)
  const cycleResult = await gildash.getCyclePaths(undefined, { maxCycles: 100 });
  let cyclePaths: ReadonlyArray<ReadonlyArray<string>> = [];

  if (!isErr(cycleResult)) {
    cyclePaths = (cycleResult as string[][]).map(p => p.map(e => resolveAbs(rootAbs, e)));
  }

  const cycles = cyclePaths.map(p => ({ path: p.map(entry => toRelativePath(rootAbs, entry)) }));
  const cuts = buildEdgeCutHints(rootAbs, cyclePaths, outDegree);

  // 4. Layer violations
  const layerViolations: DependencyLayerViolation[] = [];

  if (layerMatchers.length > 0) {
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
  const allExported = gildash.searchSymbols({ isExported: true, limit: 100_000 });

  const exportsByFile = new Map<string, Array<{ name: string; kind: string; detail: Record<string, unknown> }>>();

  if (!isErr(allExported)) {
    for (const sym of allExported) {
      const absFilePath = resolveAbs(rootAbs, sym.filePath);
      const existing = exportsByFile.get(absFilePath) ?? [];

      existing.push({ name: sym.name, kind: sym.kind, detail: sym.detail });
      exportsByFile.set(absFilePath, existing);
    }

    for (const [filePath, symbols] of exportsByFile) {
      const total = symbols.length;
      const abstract = symbols.filter(
        s =>
          s.kind === 'interface' ||
          (s.kind === 'class' &&
            Array.isArray((s.detail as Record<string, unknown>)?.modifiers) &&
            ((s.detail as Record<string, unknown>).modifiers as string[]).includes('abstract')),
      ).length;

      exportStats[toRelativePath(rootAbs, filePath)] = { total, abstract };
    }
  }

  // 6. Dead export detection
  const deadExports: DependencyDeadExportFinding[] = [];

  if (!isErr(allExported) && exportsByFile.size > 0) {
    const importRels = gildash.searchRelations({ type: 'imports', limit: 100_000 });
    const reExportRels = gildash.searchRelations({ type: 're-exports', limit: 100_000 });

    if (!isErr(importRels) || !isErr(reExportRels)) {
      const imports = isErr(importRels) ? [] : importRels;
      const reExports = isErr(reExportRels) ? [] : reExportRels;

      // Build usage map per module
      const usageByModule = new Map<
        string,
        {
          usesAll: boolean;
          names: Set<string>;
          perNameConsumerKinds: Map<string, Set<'test' | 'prod'>>;
        }
      >();

      for (const rel of [...imports, ...reExports]) {
        const target = resolveAbs(rootAbs, rel.dstFilePath);
        const consumer = resolveAbs(rootAbs, rel.srcFilePath);
        const isTestConsumer = isTestLikePath(consumer);
        const kind: 'test' | 'prod' = isTestConsumer ? 'test' : 'prod';

        const state = usageByModule.get(target) ?? {
          usesAll: false,
          names: new Set<string>(),
          perNameConsumerKinds: new Map<string, Set<'test' | 'prod'>>(),
        };

        // null/undefined dstSymbolName = namespace import (import * as X) or export *
        if (rel.dstSymbolName === null || rel.dstSymbolName === undefined) {
          state.usesAll = true;
        } else {
          state.names.add(rel.dstSymbolName);

          const prev = state.perNameConsumerKinds.get(rel.dstSymbolName) ?? new Set<'test' | 'prod'>();

          prev.add(kind);
          state.perNameConsumerKinds.set(rel.dstSymbolName, prev);
        }

        usageByModule.set(target, state);
      }

      // Entry point reachability via BFS
      const graphKeys = new Set(absGraph.keys());
      const entrySpecs = readPackageEntrypoints(rootAbs, readFn);
      const entryModules = new Set<string>();

      for (const spec of entrySpecs) {
        const resolved = resolveEntrypointToFile(rootAbs, spec, graphKeys);

        if (resolved) {
          entryModules.add(resolved);
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

      // Check each module's exports
      for (const [moduleAbs, symbols] of exportsByFile) {
        if (symbols.length === 0 || reachable.has(moduleAbs)) {
          continue;
        }

        const usage = usageByModule.get(moduleAbs);

        if (usage?.usesAll) {
          continue;
        }

        const usedNames = usage?.names ?? new Set<string>();
        const perNameConsumerKinds = usage?.perNameConsumerKinds ?? new Map<string, Set<'test' | 'prod'>>();

        for (const sym of symbols) {
          const relModule = toRelativePath(rootAbs, moduleAbs);

          if (usedNames.has(sym.name)) {
            const kinds = perNameConsumerKinds.get(sym.name) ?? new Set<'test' | 'prod'>();
            const isTestOnly = kinds.size > 0 && !kinds.has('prod');

            if (isTestOnly) {
              deadExports.push({
                kind: 'test-only-export',
                module: relModule,
                name: sym.name,
              });
            }

            continue;
          }

          deadExports.push({
            kind: 'dead-export',
            module: relModule,
            name: sym.name,
          });
        }
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
  };
};

export { analyzeDependencies, createEmptyDependencies };
