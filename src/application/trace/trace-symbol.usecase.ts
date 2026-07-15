// MUST: MUST-1
import * as path from 'node:path';

import type { FirebatLogger } from '../../shared';
import type { SourceSpan } from '../../types';

import { getDb } from '../../infrastructure/sqlite';
import { computeToolVersion, resolveRuntimeContextFromCwd, toErrorMessage } from '../../shared';
import { createArtifactStore, createGildash } from '../../store';
import { computeCacheNamespace, computeInputsDigest, computeProjectKey, computeTraceArtifactKey } from '../scan';

type TraceNodeKind = 'file' | 'symbol' | 'type' | 'reference' | 'unknown';

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
  readonly tool: 'gildash';
  readonly graph: TraceGraph;
  readonly evidence: ReadonlyArray<TraceEvidenceSpan>;
  readonly error?: string;
}

const readFileText = async (filePath: string): Promise<string> => {
  try {
    return await Bun.file(filePath).text();
  } catch {
    return '';
  }
};

const splitLines = (text: string): string[] => text.split(/\r?\n/);

const extractEvidenceText = async (filePath: string, span: SourceSpan): Promise<string | undefined> => {
  const text = await readFileText(filePath);

  if (text.length === 0) {
    return undefined;
  }

  const lines = splitLines(text);
  const lineIdx = Math.max(0, Math.min(lines.length - 1, span.start.line - 1));

  return (lines[lineIdx] ?? '').trim().slice(0, 300);
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

interface CollectTraceGraphParams {
  readonly symbol: string;
  readonly entryFile: string;
  readonly maxDepth: number | undefined;
  readonly gildash: Awaited<ReturnType<typeof createGildash>>;
}

interface CollectTraceGraphResult {
  readonly nodes: TraceNode[];
  readonly edges: TraceEdge[];
  readonly evidence: TraceEvidenceSpan[];
}

const collectTraceGraph = async (params: CollectTraceGraphParams): Promise<CollectTraceGraphResult> => {
  const { symbol, entryFile, maxDepth, gildash } = params;
  const nodes: TraceNode[] = [];
  const edges: TraceEdge[] = [];
  const evidence: TraceEvidenceSpan[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  const addNode = (node: TraceNode): void => {
    if (nodeIds.has(node.id)) {
      return;
    }

    nodeIds.add(node.id);
    nodes.push(node);
  };

  const addEdge = (edge: TraceEdge): void => {
    const id = `${edge.from}->${edge.to}:${edge.kind}:${edge.label ?? ''}`;

    if (edgeIds.has(id)) {
      return;
    }

    edgeIds.add(id);
    edges.push(edge);
  };

  // file node와 그 node로 향하는 references edge의 형태를 한 곳에 고정한다.
  const addFileNode = (filePath: string): void => {
    addNode({ id: `file:${filePath}`, kind: 'file', label: path.basename(filePath), filePath });
  };

  const addFileEdge = (from: string, filePath: string): void => {
    addEdge({ from, to: `file:${filePath}`, kind: 'references' });
  };

  const symbolNodeId = `symbol:${symbol}`;

  addNode({ id: symbolNodeId, kind: 'symbol', label: symbol, filePath: entryFile });
  addFileNode(entryFile);
  addFileEdge(symbolNodeId, entryFile);

  const refs = gildash.getSemanticReferences(symbol, entryFile);
  const refsToUse = refs.slice(0, Math.max(1, maxDepth ?? 200));

  for (const ref of refsToUse) {
    const { filePath } = ref;
    const span: SourceSpan = {
      start: { line: ref.line, column: ref.column + 1 },
      end: { line: ref.line, column: ref.column + 1 },
    };
    const refNodeId = `ref:${filePath}:${ref.line}:${ref.column}`;
    const label = ref.isDefinition
      ? `definition:${path.basename(filePath)}:${ref.line}`
      : `${path.basename(filePath)}:${ref.line}`;

    addFileNode(filePath);
    addNode({ id: refNodeId, kind: 'reference', label, filePath, span });
    addEdge({ from: symbolNodeId, to: refNodeId, kind: 'references', ...(ref.isDefinition ? { label: 'definition' } : {}) });
    addFileEdge(refNodeId, filePath);

    const text = await extractEvidenceText(filePath, span);

    evidence.push({ filePath, span, ...(text !== undefined ? { text } : {}) });
  }

  const heritage = await gildash.getHeritageChain(symbol, entryFile);

  if (heritage.children && heritage.children.length > 0) {
    for (const base of heritage.children) {
      addNode({ id: `type:${base.symbolName}`, kind: 'type', label: base.symbolName });
      addEdge({ from: symbolNodeId, to: `type:${base.symbolName}`, kind: 'type-of', label: 'extends' });
    }
  }

  return { nodes, edges, evidence };
};

const traceSymbolUseCase = async (input: TraceSymbolInput): Promise<TraceSymbolOutput> => {
  const { logger } = input;

  logger.debug('trace-symbol: start', { entryFile: input.entryFile, symbol: input.symbol, maxDepth: input.maxDepth });

  const ctx = await resolveRuntimeContextFromCwd();
  const toolVersion = computeToolVersion();
  const projectKey = computeProjectKey({ toolVersion, cwd: ctx.rootAbs });
  const db = await getDb({ rootAbs: ctx.rootAbs, logger });
  const gildash = await createGildash({ projectRoot: ctx.rootAbs, watchMode: false, semantic: true });
  const relatedFiles = await resolveRelatedFiles(input);

  logger.trace('trace-symbol: related files resolved', { count: relatedFiles.length });

  const cacheNamespace = await computeCacheNamespace({ toolVersion });
  const inputsDigest = await computeInputsDigest({ targets: relatedFiles, gildash, extraParts: [`ns:${cacheNamespace}`] });
  const entryFile = relatedFiles[0] ?? input.entryFile;
  const artifactKey = computeTraceArtifactKey({
    entryFile,
    symbol: input.symbol,
    ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}),
    ...(input.maxDepth !== undefined ? { maxDepth: input.maxDepth } : {}),
  });
  const artifactRepository = createArtifactStore(db);
  const cached = artifactRepository.get<TraceSymbolOutput>({
    projectKey,
    kind: 'gildash:traceSymbol',
    artifactKey,
    inputsDigest,
  });

  if (cached) {
    logger.debug('trace-symbol: cache hit', { artifactKey });

    await gildash.close({ cleanup: false });

    return cached;
  }

  logger.debug('trace-symbol: cache miss — running gildash trace');

  try {
    const { nodes, edges, evidence } = await collectTraceGraph({
      symbol: input.symbol,
      entryFile,
      maxDepth: input.maxDepth,
      gildash,
    });
    const output: TraceSymbolOutput = { ok: true, tool: 'gildash', graph: { nodes, edges }, evidence };

    artifactRepository.set({ projectKey, kind: 'gildash:traceSymbol', artifactKey, inputsDigest, value: output });

    return output;
  } catch (error) {
    return { ok: false, tool: 'gildash', graph: { nodes: [], edges: [] }, evidence: [], error: toErrorMessage(error) };
  } finally {
    await gildash.close({ cleanup: false });
  }
};

export { traceSymbolUseCase };
