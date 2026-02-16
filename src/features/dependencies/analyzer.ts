import * as path from 'node:path';
import { readFileSync } from 'node:fs';

import type { NodeRecord, NodeValue, ParsedFile } from '../../engine/types';
import type {
  DependencyAnalysis,
  DependencyDeadExportFinding,
  DependencyEdgeCutHint,
  DependencyFanStat,
  DependencyLayerViolation,
} from '../../types';

import { getNodeName, isNodeRecord, isOxcNode } from '../../engine/oxc-ast-utils';
import { sortDependencyFanStats } from '../../engine/sort-utils';

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

interface DependencyLayerRule {
  readonly name: string;
  readonly glob: string;
}

interface AnalyzeDependenciesInput {
  readonly rootAbs?: string;
  readonly layers?: ReadonlyArray<DependencyLayerRule>;
  readonly allowedDependencies?: Readonly<Record<string, ReadonlyArray<string>>>;
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const globToRegExp = (pattern: string): RegExp => {
  // Supports: **, *, ?, and path separators '/'.
  // - ** matches any characters including '/'
  // - * matches any characters except '/'
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

const compileLayerMatchers = (layers: ReadonlyArray<DependencyLayerRule>): ReadonlyArray<{ readonly layer: DependencyLayerRule; readonly re: RegExp }> => {
  return layers
    .filter(layer => typeof layer.name === 'string' && layer.name.trim().length > 0 && typeof layer.glob === 'string' && layer.glob.trim().length > 0)
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

  // P3-7 dependencies: dynamic import() edges
  if (node.type === 'ImportExpression') {
    const source = (node as unknown as { source?: unknown }).source as NodeValue | undefined;

    if (source && isStringLiteral(source) && typeof source.value === 'string') {
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

const isTestLikePath = (value: string): boolean => {
  const normalized = normalizePath(value);

  return (
    normalized.includes('/test/') ||
    normalized.includes('/tests/') ||
    normalized.endsWith('.test.ts') ||
    normalized.endsWith('.spec.ts') ||
    normalized.endsWith('.spec.ts')
  );
};

const readPackageEntrypoints = (rootAbs: string): ReadonlyArray<string> => {
  try {
    const raw = readFileSync(path.join(rootAbs, 'package.json'), 'utf8');
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

    // Standard entry point fields
    const scalarFields = ['main', 'module', 'browser', 'types', 'typings'] as const;

    for (const field of scalarFields) {
      if (typeof parsed[field] === 'string') {
        out.push(parsed[field] as string);
      }
    }

    // bin can be a string or an object of strings
    collectStrings(parsed.bin);

    // exports can be a complex conditional exports map
    collectStrings(parsed.exports);

    return out;
  } catch {
    return [];
  }
};

const resolveEntrypointToFile = (rootAbs: string, spec: string, fileMap: Map<string, ParsedFile>): string | null => {
  if (typeof spec !== 'string' || spec.trim().length === 0) {
    return null;
  }

  const trimmed = spec.trim();
  const rel = trimmed.startsWith('.') ? trimmed : `./${trimmed}`;
  const abs = path.resolve(rootAbs, rel);
  const candidates = [
    abs,
    `${abs}.ts`,
    path.join(abs, 'index.ts'),
  ];

  for (const candidate of candidates) {
    const normalized = normalizePath(candidate);

    if (fileMap.has(normalized)) {
      return normalized;
    }
  }

  return null;
};

const collectDeclaredExportNames = (file: ParsedFile): ReadonlyArray<string> => {
  const program = file.program as unknown;

  if (file.errors.length > 0) {
    return [];
  }

  if (!isProgramBody(program)) {
    return [];
  }

  const out = new Set<string>();

  const recordName = (name: unknown): void => {
    if (typeof name === 'string' && name.trim().length > 0) {
      out.add(name);
    }
  };

  const recordDeclarationName = (decl: NodeValue): void => {
    if (!isOxcNode(decl) || !isNodeRecord(decl)) {
      return;
    }

    if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration' || decl.type === 'TSInterfaceDeclaration') {
      recordName(getNodeName((decl as unknown as { id?: NodeValue }).id));

      return;
    }

    if (decl.type === 'TSTypeAliasDeclaration') {
      recordName(getNodeName((decl as unknown as { id?: NodeValue }).id));

      return;
    }

    if (decl.type === 'VariableDeclaration') {
      const declarations = (decl as unknown as { declarations?: unknown }).declarations;

      if (!Array.isArray(declarations)) {
        return;
      }

      for (const d of declarations) {
        if (!isOxcNode(d) || !isNodeRecord(d) || d.type !== 'VariableDeclarator') {
          continue;
        }

        const id = (d as unknown as { id?: unknown }).id as NodeValue | undefined;

        if (isOxcNode(id) && isNodeRecord(id) && id.type === 'Identifier') {
          recordName(id.name);
        }
      }
    }
  };

  for (const stmt of program.body) {
    if (!isOxcNode(stmt) || !isNodeRecord(stmt)) {
      continue;
    }

    if (stmt.type === 'ExportDefaultDeclaration') {
      out.add('default');

      continue;
    }

    if (stmt.type !== 'ExportNamedDeclaration') {
      continue;
    }

    const declaration = (stmt as unknown as { declaration?: unknown }).declaration as NodeValue | undefined;
    const specifiers = (stmt as unknown as { specifiers?: unknown }).specifiers;

    if (declaration) {
      recordDeclarationName(declaration);

      continue;
    }

    if (!Array.isArray(specifiers)) {
      continue;
    }

    for (const spec of specifiers) {
      if (!isOxcNode(spec) || !isNodeRecord(spec)) {
        continue;
      }

      const exported = (spec as unknown as { exported?: unknown }).exported as NodeValue | undefined;
      const local = (spec as unknown as { local?: unknown }).local as NodeValue | undefined;
      const exportedName = getNodeName((exported ?? local) as never);

      recordName(exportedName);
    }
  }

  return Array.from(out).sort();
};

const collectImportConsumers = (
  file: ParsedFile,
  fileMap: Map<string, ParsedFile>,
): ReadonlyArray<{
  readonly targetFilePath: string;
  readonly usesAll: boolean;
  readonly names: ReadonlyArray<string>;
}> => {
  const program = file.program as unknown;

  if (file.errors.length > 0) {
    return [];
  }

  if (!isProgramBody(program)) {
    return [];
  }

  const consumers: Array<{ targetFilePath: string; usesAll: boolean; names: string[] }> = [];
  const fromFilePath = normalizePath(file.filePath);

  const addUsage = (specifier: string, usesAll: boolean, names: string[]): void => {
    const resolved = resolveImport(fromFilePath, specifier, fileMap);

    if (!resolved) {
      return;
    }

    consumers.push({ targetFilePath: resolved, usesAll, names });
  };

  for (const stmt of program.body) {
    if (!isOxcNode(stmt) || !isNodeRecord(stmt)) {
      continue;
    }

    if (stmt.type === 'ImportDeclaration') {
      const source = stmt.source;

      if (!isStringLiteral(source)) {
        continue;
      }

      const specifiers = Array.isArray(stmt.specifiers) ? stmt.specifiers : [];
      const names: string[] = [];
      let usesAll = false;

      for (const spec of specifiers) {
        if (!isOxcNode(spec) || !isNodeRecord(spec)) {
          continue;
        }

        if (spec.type === 'ImportNamespaceSpecifier') {
          usesAll = true;
        }

        if (spec.type === 'ImportDefaultSpecifier') {
          names.push('default');
        }

        if (spec.type === 'ImportSpecifier') {
          const imported = (spec as unknown as { imported?: unknown }).imported as NodeValue | undefined;
          const importedName = getNodeName(imported as never);

          if (typeof importedName === 'string' && importedName.trim().length > 0) {
            names.push(importedName);
          }
        }
      }

      addUsage(source.value, usesAll, names);

      continue;
    }

    if (stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportAllDeclaration') {
      const source = (stmt as unknown as { source?: unknown }).source;

      if (!isStringLiteral(source as never)) {
        continue;
      }

      if (stmt.type === 'ExportAllDeclaration') {
        addUsage((source as { value: string }).value, true, []);

        continue;
      }

      const specifiers = (stmt as unknown as { specifiers?: unknown }).specifiers;

      if (!Array.isArray(specifiers)) {
        continue;
      }

      const names: string[] = [];

      for (const spec of specifiers) {
        if (!isOxcNode(spec) || !isNodeRecord(spec)) {
          continue;
        }

        const local = (spec as unknown as { local?: unknown }).local as NodeValue | undefined;
        const importedName = getNodeName(local as never);

        if (typeof importedName === 'string' && importedName.trim().length > 0) {
          names.push(importedName);
        }
      }

      addUsage((source as { value: string }).value, false, names);
    }
  }

  return consumers;
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
    path.join(base, 'index.ts'),
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

const isProgramBody = (value: unknown): value is { readonly body: ReadonlyArray<NodeValue> } => {
  return !!value && typeof value === 'object' && Array.isArray((value as { body?: unknown }).body);
};

const collectExportStats = (
  file: ParsedFile,
): {
  readonly total: number;
  readonly abstract: number;
} => {
  if (file.errors.length > 0) {
    return { total: 0, abstract: 0 };
  }

  const program = file.program as unknown;

  if (!isProgramBody(program)) {
    return { total: 0, abstract: 0 };
  }

  const declaredInterfaces = new Set<string>();
  const declaredAbstractClasses = new Set<string>();

  for (const stmt of program.body) {
    if (!isOxcNode(stmt) || !isNodeRecord(stmt)) {
      continue;
    }

    if (stmt.type === 'TSInterfaceDeclaration') {
      const name = getNodeName((stmt as unknown as { id?: NodeValue }).id);

      if (typeof name === 'string' && name.trim().length > 0) {
        declaredInterfaces.add(name);
      }

      continue;
    }

    if (stmt.type === 'ClassDeclaration') {
      const abstractFlag = !!(stmt as unknown as { abstract?: unknown }).abstract;

      if (!abstractFlag) {
        continue;
      }

      const name = getNodeName((stmt as unknown as { id?: NodeValue }).id);

      if (typeof name === 'string' && name.trim().length > 0) {
        declaredAbstractClasses.add(name);
      }
    }
  }

  let total = 0;
  let abstract = 0;

  const record = (kind: 'interface' | 'abstract-class' | 'other'): void => {
    total += 1;

    if (kind === 'interface' || kind === 'abstract-class') {
      abstract += 1;
    }
  };

  const recordDeclaration = (decl: NodeValue): void => {
    if (!isOxcNode(decl) || !isNodeRecord(decl)) {
      return;
    }

    if (decl.type === 'TSInterfaceDeclaration') {
      record('interface');

      return;
    }

    if (decl.type === 'ClassDeclaration') {
      const abstractFlag = !!(decl as unknown as { abstract?: unknown }).abstract;

      record(abstractFlag ? 'abstract-class' : 'other');

      return;
    }

    // Types, consts, functions, enums, namespaces, etc.
    record('other');
  };

  for (const stmt of program.body) {
    if (!isOxcNode(stmt) || !isNodeRecord(stmt)) {
      continue;
    }

    if (stmt.type === 'ExportNamedDeclaration') {
      const source = (stmt as unknown as { source?: unknown }).source;

      // Ignore re-exports (cannot attribute abstractness without resolution).
      if (source != null) {
        continue;
      }

      const declaration = (stmt as unknown as { declaration?: unknown }).declaration;

      if (declaration != null) {
        recordDeclaration(declaration as NodeValue);

        continue;
      }

      const specifiers = (stmt as unknown as { specifiers?: unknown }).specifiers;

      if (!Array.isArray(specifiers)) {
        continue;
      }

      for (const spec of specifiers) {
        if (!isOxcNode(spec) || !isNodeRecord(spec)) {
          continue;
        }

        const local = (spec as unknown as { local?: unknown }).local;
        const localName = getNodeName(local as never);

        if (typeof localName !== 'string' || localName.trim().length === 0) {
          record('other');

          continue;
        }

        if (declaredInterfaces.has(localName)) {
          record('interface');
        } else if (declaredAbstractClasses.has(localName)) {
          record('abstract-class');
        } else {
          record('other');
        }
      }

      continue;
    }

    if (stmt.type === 'ExportDefaultDeclaration') {
      const declaration = (stmt as unknown as { declaration?: unknown }).declaration;

      recordDeclaration(declaration as NodeValue);
    }
  }

  return { total, abstract };
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

interface SccResult {
  readonly components: ReadonlyArray<ReadonlyArray<string>>;
}

const tarjanScc = (graph: Map<string, ReadonlyArray<string>>): SccResult => {
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowlinks = new Map<string, number>();
  const components: string[][] = [];

  const strongConnect = (node: string): void => {
    indices.set(node, index);
    lowlinks.set(node, index);

    index += 1;

    stack.push(node);
    onStack.add(node);

    for (const next of graph.get(node) ?? []) {
      if (!indices.has(next)) {
        strongConnect(next);
        lowlinks.set(node, Math.min(lowlinks.get(node) ?? 0, lowlinks.get(next) ?? 0));
      } else if (onStack.has(next)) {
        lowlinks.set(node, Math.min(lowlinks.get(node) ?? 0, indices.get(next) ?? 0));
      }
    }

    if (lowlinks.get(node) === indices.get(node)) {
      const component: string[] = [];
      let current = '';

      do {
        current = stack.pop() ?? '';

        onStack.delete(current);
        component.push(current);
      } while (current !== node && stack.length > 0);

      components.push(component);
    }
  };

  for (const node of graph.keys()) {
    if (!indices.has(node)) {
      strongConnect(node);
    }
  }

  return { components };
};

const johnsonCircuits = (
  scc: ReadonlyArray<string>,
  adjacency: Map<string, ReadonlyArray<string>>,
  maxCircuits: number,
): string[][] => {
  const cycles: string[][] = [];
  const cycleKeys = new Set<string>();
  const nodes = [...scc].sort(compareStrings);

  const unblock = (node: string, blocked: Set<string>, blockMap: Map<string, Set<string>>): void => {
    blocked.delete(node);

    const blockedBy = blockMap.get(node);

    if (!blockedBy) {
      return;
    }

    for (const entry of blockedBy) {
      if (blocked.has(entry)) {
        unblock(entry, blocked, blockMap);
      }
    }

    blockedBy.clear();
  };

  for (let index = 0; index < nodes.length && cycles.length < maxCircuits; index += 1) {
    const start = nodes[index] ?? '';
    const allowed = new Set(nodes.slice(index));
    const blocked = new Set<string>();
    const blockMap = new Map<string, Set<string>>();
    const stack: string[] = [];

    const neighbors = (value: string): ReadonlyArray<string> => (adjacency.get(value) ?? []).filter(entry => allowed.has(entry));

    const circuit = (node: string): boolean => {
      if (cycles.length >= maxCircuits) {
        return true;
      }

      let found = false;

      stack.push(node);
      blocked.add(node);

      for (const next of neighbors(node)) {
        if (cycles.length >= maxCircuits) {
          break;
        }

        if (next === start) {
          recordCyclePath(cycleKeys, cycles, stack.concat(start));

          found = true;
        } else if (!blocked.has(next)) {
          if (circuit(next)) {
            found = true;
          }
        }
      }

      if (found) {
        unblock(node, blocked, blockMap);
      } else {
        for (const next of neighbors(node)) {
          const blockedBy = blockMap.get(next) ?? new Set<string>();

          blockedBy.add(node);
          blockMap.set(next, blockedBy);
        }
      }

      stack.pop();

      return found;
    };

    circuit(start);
  }

  return cycles;
};

const detectCycles = (adjacency: Map<string, ReadonlyArray<string>>): ReadonlyArray<ReadonlyArray<string>> => {
  const { components } = tarjanScc(adjacency);
  const cycles: string[][] = [];
  const cycleKeys = new Set<string>();

  for (const component of components) {
    if (component.length === 0) {
      continue;
    }

    if (component.length === 1) {
      const node = component[0] ?? '';
      const next = adjacency.get(node) ?? [];

      if (next.includes(node)) {
        recordCyclePath(cycleKeys, cycles, [node, node]);
      }

      continue;
    }

    const circuits = johnsonCircuits(component, adjacency, 100);

    for (const circuit of circuits) {
      recordCyclePath(cycleKeys, cycles, circuit);
    }
  }

  return cycles;
};

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

const analyzeDependencies = (files: ReadonlyArray<ParsedFile>, input?: AnalyzeDependenciesInput): DependencyAnalysis => {
  const hasInputs = files.length > 0;
  const empty = createEmptyDependencies();

  const rootAbs = input?.rootAbs ?? process.cwd();
  const layerMatchers = input?.layers ? compileLayerMatchers(input.layers) : [];
  const allowedDependencies = input?.allowedDependencies ?? {};

  if (!hasInputs) {
    return empty;
  }

  const adjacency = buildAdjacency(files);
  const fileMap = buildFileMap(files);
  const adjacencyOut: Record<string, ReadonlyArray<string>> = {};
  const exportStats: Record<string, { readonly total: number; readonly abstract: number }> = {};
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();

  for (const [from, targets] of adjacency.entries()) {
    adjacencyOut[toRelativePath(rootAbs, from)] = targets.map(target => toRelativePath(rootAbs, target));

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
  const cycles = cyclePaths.map(path => ({ path: path.map(entry => toRelativePath(rootAbs, entry)) }));
  const fanIn = listFanStats(rootAbs, inDegree, 10);
  const fanOut = listFanStats(rootAbs, outDegree, 10);
  const cuts = buildEdgeCutHints(rootAbs, cyclePaths, outDegree);
  const layerViolations: DependencyLayerViolation[] = [];
  const deadExports: DependencyDeadExportFinding[] = [];

  if (layerMatchers.length > 0) {
    for (const [from, targets] of adjacency.entries()) {
      const fromLayer = matchLayerName(rootAbs, from, layerMatchers);

      if (!fromLayer) {
        continue;
      }

      const allowed = allowedDependencies[fromLayer] ?? [];

      for (const target of targets) {
        const toLayer = matchLayerName(rootAbs, target, layerMatchers);

        if (!toLayer) {
          continue;
        }

        if (fromLayer === toLayer) {
          continue;
        }

        if (allowed.includes(toLayer)) {
          continue;
        }

        layerViolations.push({
          kind: 'layer-violation',
          from: toRelativePath(rootAbs, from),
          to: toRelativePath(rootAbs, target),
          fromLayer,
          toLayer,
        });
      }
    }
  }

  for (const file of files) {
    const key = toRelativePath(rootAbs, normalizePath(file.filePath));

    exportStats[key] = collectExportStats(file);
  }

  // P3-6 dependencies: dead export detection (best-effort)
  {
    const exportsByModule = new Map<string, ReadonlyArray<string>>();
    const usageByModule = new Map<
      string,
      {
        readonly usesAll: boolean;
        readonly names: Set<string>;
        readonly consumers: Set<string>;
        readonly perNameConsumerKinds: Map<string, Set<'test' | 'prod'>>;
      }
    >();

    for (const file of files) {
      const moduleAbs = normalizePath(file.filePath);
      exportsByModule.set(moduleAbs, collectDeclaredExportNames(file));
    }

    for (const file of files) {
      const consumerAbs = normalizePath(file.filePath);
      const isTestConsumer = isTestLikePath(consumerAbs);
      const consumers = collectImportConsumers(file, fileMap);

      for (const entry of consumers) {
        const state =
          usageByModule.get(entry.targetFilePath) ??
          ({ usesAll: false, names: new Set<string>(), consumers: new Set<string>(), perNameConsumerKinds: new Map() } as const);

        const mergedUsesAll = state.usesAll || entry.usesAll;
        const mergedNames = new Set(state.names);

        for (const n of entry.names) {
          mergedNames.add(n);
        }

        const mergedConsumers = new Set(state.consumers);
        mergedConsumers.add(`${consumerAbs}::${isTestConsumer ? 'test' : 'prod'}`);

        const mergedPerName = new Map(state.perNameConsumerKinds);

        for (const n of entry.names) {
          const prev = mergedPerName.get(n) ?? new Set<'test' | 'prod'>();
          const next = new Set(prev);
          next.add(isTestConsumer ? 'test' : 'prod');
          mergedPerName.set(n, next);
        }

        usageByModule.set(entry.targetFilePath, {
          usesAll: mergedUsesAll,
          names: mergedNames,
          consumers: mergedConsumers,
          perNameConsumerKinds: mergedPerName,
        });
      }
    }

    const entrySpecs = readPackageEntrypoints(rootAbs);
    const entryModules = new Set<string>();

    for (const spec of entrySpecs) {
      const resolved = resolveEntrypointToFile(rootAbs, spec, fileMap);

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
      const current = queue.shift() ?? '';

      for (const next of adjacency.get(current) ?? []) {
        if (reachable.has(next)) {
          continue;
        }

        reachable.add(next);
        queue.push(next);
      }
    }

    for (const [moduleAbs, exportedNames] of exportsByModule.entries()) {
      if (exportedNames.length === 0) {
        continue;
      }

      // Skip exports reachable from package entrypoints (public API surface).
      if (reachable.has(moduleAbs)) {
        continue;
      }

      const usage = usageByModule.get(moduleAbs);

      if (usage?.usesAll) {
        continue;
      }

      const usedNames = usage?.names ?? new Set<string>();
      const perNameConsumerKinds = usage?.perNameConsumerKinds ?? new Map<string, Set<'test' | 'prod'>>();

      for (const exportName of exportedNames) {
        const relModule = toRelativePath(rootAbs, moduleAbs);

        if (usedNames.has(exportName)) {
          const kinds = perNameConsumerKinds.get(exportName) ?? new Set<'test' | 'prod'>();
          const isTestOnly = kinds.size > 0 && !kinds.has('prod');

          if (isTestOnly) {
            deadExports.push({
              kind: 'test-only-export',
              module: relModule,
              name: exportName,
            });
          }

          continue;
        }

        deadExports.push({
          kind: 'dead-export',
          module: relModule,
          name: exportName,
        });
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
