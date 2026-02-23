// MUST: MUST-1
import * as path from 'node:path';

import type { FirebatLogger } from '../../shared/logger';
import type { SourceSpan } from '../../types';

import { initHasher } from '../../engine/hasher';
import { getDb } from '../../infrastructure/sqlite/firebat.db';
import { runTsgoTraceSymbol } from '../../tooling/tsgo/tsgo-runner';
import { resolveRuntimeContextFromCwd } from '../../shared/runtime-context';
import { createArtifactStore } from '../../store/artifact';
import { createFileIndexStore } from '../../store/file-index';
import { computeToolVersion } from '../../shared/tool-version';
import { indexTargets } from '../indexing/file-indexer';
import { computeProjectKey, computeTraceArtifactKey } from '../scan/cache-keys';
import { computeCacheNamespace } from '../scan/cache-namespace';
import { computeInputsDigest } from '../scan/inputs-digest';

type TraceNodeKind = 'file' | 'symbol' | 'type' | 'reference' | 'unknown';

interface JsonObject {
  readonly [k: string]: JsonValue;
}

type JsonValue = null | boolean | number | string | ReadonlyArray<JsonValue> | JsonObject;

interface StructuredTrace extends JsonObject {
  readonly graph?: JsonValue;
  readonly evidence?: JsonValue;
}

interface TraceNode {
  readonly id: string;
  readonly kind: TraceNodeKind;
  readonly label: string;
  readonly filePath?: string;
  readonly span?: SourceSpan;
}

type TraceEdgeKind = 'references' | 'imports' | 'exports' | 'calls' | 'type-of' | 'unknown';

interface TraceEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: TraceEdgeKind;
  readonly label?: string;
}

interface TraceGraph {
  readonly nodes: ReadonlyArray<TraceNode>;
  readonly edges: ReadonlyArray<TraceEdge>;
}

interface TraceEvidenceSpan {
  readonly filePath: string;
  readonly span: SourceSpan;
  readonly text?: string;
}

interface TraceSymbolInput {
  readonly entryFile: string;
  readonly symbol: string;
  readonly tsconfigPath?: string;
  readonly maxDepth?: number;
  readonly logger: FirebatLogger;
}

interface TraceSymbolOutput {
  readonly ok: boolean;
  readonly tool: 'tsgo';
  readonly graph: TraceGraph;
  readonly evidence: ReadonlyArray<TraceEvidenceSpan>;
  readonly error?: string;
  readonly raw?: JsonValue;
}

interface NormalizeTraceInput {
  readonly structured: JsonValue | undefined;
}

interface NormalizeTraceResult {
  readonly graph: TraceGraph;
  readonly evidence: TraceEvidenceSpan[];
  readonly raw?: JsonValue;
}

const isObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const getString = (obj: JsonObject, key: string): string | undefined => {
  const value = obj[key];

  return typeof value === 'string' ? value : undefined;
};

const getArray = (obj: JsonObject, key: string): ReadonlyArray<JsonValue> | undefined => {
  const value = obj[key];

  return Array.isArray(value) ? value : undefined;
};

const isTraceNodeKind = (value: JsonValue | undefined): value is TraceNodeKind =>
  typeof value === 'string' &&
  (value === 'file' || value === 'symbol' || value === 'type' || value === 'reference' || value === 'unknown');

const isTraceEdgeKind = (value: JsonValue | undefined): value is TraceEdgeKind =>
  typeof value === 'string' &&
  (value === 'references' ||
    value === 'imports' ||
    value === 'exports' ||
    value === 'calls' ||
    value === 'type-of' ||
    value === 'unknown');

const toTraceNodes = (value: ReadonlyArray<JsonValue>): TraceNode[] => {
  if (value.length === 0) {
    return [];
  }

  const out: TraceNode[] = [];

  for (const item of value) {
    if (!isObject(item)) {
      continue;
    }

    const id = getString(item, 'id');
    const label = getString(item, 'label');
    const kindRaw = item.kind;
    const kind = isTraceNodeKind(kindRaw) ? kindRaw : undefined;

    if (id === undefined || id.length === 0 || label === undefined || label.length === 0 || kind === undefined) {
      continue;
    }

    const filePath = getString(item, 'filePath');

    out.push({ id, kind, label, ...(filePath !== undefined ? { filePath } : {}) });
  }

  return out;
};

const toTraceEdges = (value: ReadonlyArray<JsonValue>): TraceEdge[] => {
  if (value.length === 0) {
    return [];
  }

  const out: TraceEdge[] = [];

  for (const item of value) {
    if (!isObject(item)) {
      continue;
    }

    const from = getString(item, 'from');
    const to = getString(item, 'to');
    const kindRaw = item.kind;
    const kind = isTraceEdgeKind(kindRaw) ? kindRaw : undefined;

    if (from === undefined || from.length === 0 || to === undefined || to.length === 0 || kind === undefined) {
      continue;
    }

    const label = getString(item, 'label');

    out.push({ from, to, kind, ...(label !== undefined ? { label } : {}) });
  }

  return out;
};

const toSourceSpan = (value: JsonValue | undefined): SourceSpan | null => {
  if (!isObject(value)) {
    return null;
  }

  let span: SourceSpan | null = null;
  const start = value.start;
  const end = value.end;

  if (isObject(start) && isObject(end)) {
    const startLine = start.line;
    const startColumn = start.column;
    const endLine = end.line;
    const endColumn = end.column;

    if (
      typeof startLine === 'number' &&
      typeof startColumn === 'number' &&
      typeof endLine === 'number' &&
      typeof endColumn === 'number'
    ) {
      span = {
        start: { line: startLine, column: startColumn },
        end: { line: endLine, column: endColumn },
      };
    }
  }

  return span;
};

const toEvidenceSpans = (value: ReadonlyArray<JsonValue>): TraceEvidenceSpan[] => {
  if (value.length === 0) {
    return [];
  }

  const out: TraceEvidenceSpan[] = [];

  for (const item of value) {
    if (!isObject(item)) {
      continue;
    }

    const filePath = getString(item, 'filePath');
    const span = toSourceSpan(item.span);

    if (filePath === undefined || filePath.length === 0 || span === null) {
      continue;
    }

    const text = getString(item, 'text');

    out.push({ filePath, span, ...(text !== undefined ? { text } : {}) });
  }

  return out;
};

const normalizeTrace = (input: NormalizeTraceInput): NormalizeTraceResult => {
  const empty: TraceGraph = { nodes: [], edges: [] };

  if (!isObject(input.structured)) {
    return input.structured === undefined
      ? { graph: empty, evidence: [] }
      : { graph: empty, evidence: [], raw: input.structured };
  }

  const structured = input.structured as StructuredTrace;
  // Best-effort: if caller already returns {graph, evidence}
  const graph = isObject(structured.graph) ? structured.graph : undefined;
  const nodes = graph ? getArray(graph, 'nodes') : undefined;
  const edges = graph ? getArray(graph, 'edges') : undefined;

  if (graph !== undefined && nodes !== undefined && edges !== undefined) {
    return {
      graph: { nodes: toTraceNodes(nodes), edges: toTraceEdges(edges) },
      evidence: Array.isArray(structured.evidence) ? toEvidenceSpans(structured.evidence) : [],
      raw: structured,
    };
  }

  return { graph: empty, evidence: [], raw: structured };
};

const resolveRelatedFiles = async (input: TraceSymbolInput): Promise<string[]> => {
  const files: string[] = [path.resolve(process.cwd(), input.entryFile)];

  if (input.tsconfigPath === undefined || input.tsconfigPath.trim().length === 0) {
    return files;
  }

  const tsconfig = path.resolve(process.cwd(), input.tsconfigPath);
  const exists = await Bun.file(tsconfig).exists();

  if (exists) {
    files.push(tsconfig);
  }

  return files;
};

const traceSymbolUseCase = async (input: TraceSymbolInput): Promise<TraceSymbolOutput> => {
  const { logger } = input;

  logger.debug('trace-symbol: start', { entryFile: input.entryFile, symbol: input.symbol, maxDepth: input.maxDepth });

  await initHasher();

  const ctx = await resolveRuntimeContextFromCwd();
  const toolVersion = computeToolVersion();
  const projectKey = computeProjectKey({ toolVersion, cwd: ctx.rootAbs });
  const db = await getDb({ rootAbs: ctx.rootAbs, logger });
  const artifactRepository = createArtifactStore(db);
  const fileIndexRepository = createFileIndexStore(db);
  const relatedFiles = await resolveRelatedFiles(input);

  logger.trace('trace-symbol: related files resolved', { count: relatedFiles.length });

  await indexTargets({ projectKey, targets: relatedFiles, repository: fileIndexRepository, concurrency: 4, logger });

  const cacheNamespace = await computeCacheNamespace({ toolVersion });
  const inputsDigest = await computeInputsDigest({
    projectKey,
    targets: relatedFiles,
    fileIndexRepository,
    extraParts: [`ns:${cacheNamespace}`],
  });
  const artifactKey = computeTraceArtifactKey({
    entryFile: relatedFiles[0] ?? input.entryFile,
    symbol: input.symbol,
    ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}),
    ...(input.maxDepth !== undefined ? { maxDepth: input.maxDepth } : {}),
  });
  const cached = artifactRepository.get<TraceSymbolOutput>({
    projectKey,
    kind: 'tsgo:traceSymbol',
    artifactKey,
    inputsDigest,
  });

  if (cached) {
    logger.debug('trace-symbol: cache hit', { artifactKey });

    return cached;
  }

  logger.debug('trace-symbol: cache miss — running tsgo trace');

  const tsgoRequest: Parameters<typeof runTsgoTraceSymbol>[0] = {
    entryFile: relatedFiles[0] ?? input.entryFile,
    symbol: input.symbol,
    ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}),
    ...(input.maxDepth !== undefined ? { maxDepth: input.maxDepth } : {}),
  };
  const result = await runTsgoTraceSymbol(tsgoRequest);

  logger.trace('trace-symbol: tsgo result', { ok: result.ok, error: result.error });

  const normalized = normalizeTrace({ structured: result.structured as JsonValue | undefined });
  const outputBase = {
    ok: result.ok,
    tool: 'tsgo' as const,
    graph: normalized.graph,
    evidence: normalized.evidence,
  };
  const output: TraceSymbolOutput = {
    ...outputBase,
    ...(result.error !== undefined ? { error: result.error } : {}),
    ...(normalized.raw !== undefined ? { raw: normalized.raw } : {}),
  };

  artifactRepository.set({
    projectKey,
    kind: 'tsgo:traceSymbol',
    artifactKey,
    inputsDigest,
    value: output,
  });

  return output;
};

export { traceSymbolUseCase };
export type { TraceSymbolInput, TraceSymbolOutput };
