import * as path from 'node:path';

import type { NodeRecord, NodeValue, ParsedFile } from '../../engine/types';
import type { DependencyAnalysis, DependencyEdgeCutHint, DependencyFanStat } from '../../types';

import { isNodeRecord, isOxcNode } from '../../engine/oxc-ast-utils';
import { sortDependencyFanStats } from '../../engine/sort-utils';

const createEmptyDependencies = (): DependencyAnalysis => ({
  cycles: [],
  fanInTop: [],
  fanOutTop: [],
  edgeCutHints: [],
});

const normalizePath = (value: string): string => value.replaceAll('\\', '/');

const toRelativePath = (value: string): string => normalizePath(path.relative(process.cwd(), value));

const isNodeValueArray = (value: NodeValue): value is ReadonlyArray<NodeValue> => Array.isArray(value);

const isStringLiteral = (value: NodeValue): value is NodeRecord => {
  if (!isOxcNode(value)) {
    return false;
  }

  if (!isNodeRecord(value)) {
    return false;
  }

  if (value.type !== 'Literal') {
    return false;
  }

  const literalValue = value.value;

  return typeof literalValue === 'string';
};

const collectImportSources = (node: NodeValue, sources: string[]): void => {
  if (isNodeValueArray(node)) {
    for (const entry of node) {
      collectImportSources(entry, sources);
    }

    return;
  }

  if (!isOxcNode(node)) {
    return;
  }

  if (!isNodeRecord(node)) {
    return;
  }

  if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
    const source = node.source;

    if (isStringLiteral(source) && typeof source.value === 'string') {
      sources.push(source.value);
    }
  }

  for (const value of Object.values(node)) {
    if (value === node || value === null || value === undefined) {
      continue;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      continue;
    }

    collectImportSources(value as NodeValue, sources);
  }
};

const buildFileMap = (files: ReadonlyArray<ParsedFile>): Map<string, ParsedFile> => {
  const map = new Map<string, ParsedFile>();

  for (const file of files) {
    map.set(normalizePath(file.filePath), file);
  }

  return map;
};

const resolveImport = (fromPath: string, specifier: string, fileMap: Map<string, ParsedFile>): string | null => {
  if (!specifier.startsWith('.')) {
    return null;
  }

  const base = path.resolve(path.dirname(fromPath), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
    path.join(base, 'index.mjs'),
    path.join(base, 'index.cjs'),
  ];

  for (const candidate of candidates) {
    const normalized = normalizePath(candidate);

    if (fileMap.has(normalized)) {
      return normalized;
    }
  }

  return null;
};

const buildAdjacency = (files: ReadonlyArray<ParsedFile>): Map<string, ReadonlyArray<string>> => {
  const fileMap = buildFileMap(files);
  const adjacency = new Map<string, ReadonlyArray<string>>();

  for (const file of files) {
    const normalized = normalizePath(file.filePath);
    const sources: string[] = [];

    collectImportSources(file.program as NodeValue, sources);

    const targets = new Set<string>();

    for (const source of sources) {
      const resolved = resolveImport(normalized, source, fileMap);

      if (resolved !== null && resolved.length > 0) {
        targets.add(resolved);
      }
    }

    adjacency.set(normalized, Array.from(targets).sort());
  }

  return adjacency;
};

const compareStrings = (left: string, right: string): number => left.localeCompare(right);

const normalizeCycle = (cycle: ReadonlyArray<string>): string[] => {
  const unique = cycle.length > 1 && cycle[0] === cycle[cycle.length - 1] ? cycle.slice(0, -1) : [...cycle];

  if (unique.length === 0) {
    return [];
  }

  let best = unique;

  for (let index = 1; index < unique.length; index += 1) {
    const rotated = unique.slice(index).concat(unique.slice(0, index));

    if (rotated.join('::') < best.join('::')) {
      best = rotated;
    }
  }

  return best.concat(best[0] ?? '');
};

const recordCyclePath = (cycleKeys: Set<string>, cycles: string[][], path: ReadonlyArray<string>): void => {
  const normalized = normalizeCycle(path);

  if (normalized.length === 0) {
    return;
  }

  const key = normalized.join('->');

  if (cycleKeys.has(key)) {
    return;
  }

  cycleKeys.add(key);
  cycles.push(normalized);
};

const walkCycles = (
  node: string,
  adjacency: Map<string, ReadonlyArray<string>>,
  visited: Set<string>,
  inStack: Set<string>,
  stack: string[],
  cycleKeys: Set<string>,
  cycles: string[][],
): void => {
  if (inStack.has(node)) {
    const index = stack.indexOf(node);

    if (index >= 0) {
      recordCyclePath(cycleKeys, cycles, stack.slice(index).concat(node));
    }

    return;
  }

  if (visited.has(node)) {
    return;
  }

  visited.add(node);
  inStack.add(node);
  stack.push(node);

  const next = adjacency.get(node) ?? [];

  for (const entry of next) {
    walkCycles(entry, adjacency, visited, inStack, stack, cycleKeys, cycles);
  }

  stack.pop();
  inStack.delete(node);
};

const detectCycles = (adjacency: Map<string, ReadonlyArray<string>>): ReadonlyArray<ReadonlyArray<string>> => {
  const nodes = Array.from(adjacency.keys()).sort(compareStrings);
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const cycleKeys = new Set<string>();

  for (const node of nodes) {
    walkCycles(node, adjacency, visited, inStack, stack, cycleKeys, cycles);
  }

  return cycles;
};

const listFanStats = (counts: Map<string, number>, limit: number): ReadonlyArray<DependencyFanStat> => {
  const items = Array.from(counts.entries())
    .filter(([, count]) => count > 0)
    .map(([module, count]) => ({ module: toRelativePath(module), count }));

  return sortDependencyFanStats(items).slice(0, limit);
};

const buildEdgeCutHints = (
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
      from: toRelativePath(from),
      to: toRelativePath(to),
      score: bestScore > 0 ? bestScore : 1,
      reason: 'breaks cycle',
    });
  }

  return hints;
};

const analyzeDependencies = (files: ReadonlyArray<ParsedFile>): DependencyAnalysis => {
  const hasInputs = files.length > 0;
  const empty = createEmptyDependencies();

  if (!hasInputs) {
    return empty;
  }

  const adjacency = buildAdjacency(files);
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();

  for (const [from, targets] of adjacency.entries()) {
    outDegree.set(from, targets.length);

    if (!inDegree.has(from)) {
      inDegree.set(from, 0);
    }

    for (const target of targets) {
      const prev = inDegree.get(target) ?? 0;

      inDegree.set(target, prev + 1);
    }
  }

  const cyclePaths = detectCycles(adjacency);
  const cycles = cyclePaths.map(path => ({ path: path.map(toRelativePath) }));
  const fanInTop = listFanStats(inDegree, 10);
  const fanOutTop = listFanStats(outDegree, 10);
  const edgeCutHints = buildEdgeCutHints(cyclePaths, outDegree);

  return {
    cycles,
    fanInTop,
    fanOutTop,
    edgeCutHints,
  };
};

export { analyzeDependencies, createEmptyDependencies };
