import * as path from 'node:path';

import type { TsgoLspSession } from '../../tooling/tsgo/tsgo-runner';
import type { FirebatLogger } from '../../ports/logger';
import type { SymbolMatch } from '../../ports/symbol-index.repository';

import { openTsDocument, withTsgoLspSession, lspUriToFilePath } from '../../tooling/tsgo/tsgo-runner';
import { indexSymbolsUseCase, searchSymbolFromIndexUseCase } from '../symbol-index/symbol-index.usecases';

type LineParam = number | string;

interface LspPosition {
  line: number;
  character: number;
}

interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

interface LspTextEdit {
  range: LspRange;
  newText: string;
}

interface WorkspaceEdit {
  changes?: Record<string, LspTextEdit[]>;
  documentChanges?: unknown;
}

interface LspLocation {
  uri: string;
  range: LspRange;
}

interface LspReference {
  filePath: string;
  range: LspRange;
  snippet?: string;
}

interface LspDefinition {
  filePath: string;
  range: LspRange;
  preview?: string;
}

interface ParsedImport {
  kind: string;
  specifier: string;
  raw: string;
  names?: string[];
  resolvedPath?: string | null;
}

interface TypedDependency {
  name: string;
  version: string;
  hasTypes: boolean;
}

interface ExternalLibrarySymbol {
  library: string;
  symbolName: string;
  kind: string;
  filePath: string;
  line: number;
}

interface UriRangeUnknownRecord {
  uri?: unknown;
  range?: unknown;
}

interface LocationLikeRecord {
  uri?: string;
  range?: LspRange;
}

interface ActionKindRecord {
  kind?: unknown;
}

interface InitializeResultLike {
  capabilities?: unknown;
}

interface LspChangedResult {
  changed: boolean;
}

interface LspChangedFilesResult {
  changedFiles: string[];
}

type LspClient = TsgoLspSession['lsp'];

interface BaseInput {
  root: string;
  logger: FirebatLogger;
  tsconfigPath?: string;
}

interface FilePathInput {
  filePath: string;
}

interface LineInput {
  line: LineParam;
}

interface CharacterInput {
  character?: number;
}

interface TargetInput {
  target?: string;
}

interface SymbolNameInput {
  symbolName: string;
}

interface DiagnosticsOptions {
  timeoutMs?: number;
  forceRefresh?: boolean;
}

interface CodeActionsOptions {
  startLine: LineParam;
  endLine?: LineParam;
  includeKinds?: ReadonlyArray<string>;
}

interface RenameOptions {
  line?: LineParam;
  symbolName: string;
  newName: string;
}

interface DeleteOptions {
  line: LineParam;
  symbolName: string;
}

interface WorkspaceQueryInput {
  query?: string;
}

type FileInput = BaseInput & FilePathInput;

type HoverInput = FileInput & LineInput & CharacterInput & TargetInput;

type SymbolAtLineInput = FileInput & LineInput & SymbolNameInput;

type DiagnosticsInput = FileInput & DiagnosticsOptions;

type CompletionInput = FileInput & LineInput & CharacterInput;

type SignatureHelpInput = FileInput & LineInput & CharacterInput;

type CodeActionsInput = FileInput & CodeActionsOptions;

type RenameInput = FileInput & RenameOptions;

type DeleteInput = FileInput & DeleteOptions;

type RootInput = BaseInput;

interface ExternalSymbolsInput {
  root: string;
  filePath: string;
}

interface ParseImportsInput {
  root: string;
  filePath: string;
}

interface TypeDepsInput {
  root: string;
  logger: FirebatLogger;
}

interface ExternalIndexInput {
  root: string;
  maxFiles?: number;
  includePatterns?: ReadonlyArray<string>;
  excludePatterns?: ReadonlyArray<string>;
  logger: FirebatLogger;
}

interface ExternalSearchInput {
  root: string;
  libraryName?: string;
  symbolName?: string;
  kind?: string;
  limit?: number;
}

interface ResultStatus {
  ok: boolean;
  error?: string;
}

type ResultWithError<T> = T & ResultStatus;

interface OpenDocumentInput {
  lsp: LspClient;
  fileAbs: string;
  languageId?: string;
}

interface OpenedDocument {
  uri: string;
  text: string;
  lines: string[];
}

interface HoverPayload {
  hover?: unknown;
  note?: string;
}

interface ReferencesPayload {
  references?: LspReference[];
}

interface DefinitionsPayload {
  definitions?: LspDefinition[];
}

interface DiagnosticsPayload {
  diagnostics?: unknown;
}

interface SymbolsPayload {
  symbols?: unknown;
}

interface CompletionPayload {
  completion?: unknown;
}

interface SignatureHelpPayload {
  signatureHelp?: unknown;
}

interface FormatPayload {
  changed?: boolean;
}

interface CodeActionsPayload {
  actions?: unknown;
}

interface RenamePayload {
  changedFiles?: string[];
}

interface DeletePayload {
  changed?: boolean;
}

interface CapabilitiesPayload {
  capabilities?: unknown;
  note?: string;
}

interface ExternalSymbolsPayload {
  symbols: string[];
}

interface ParseImportsPayload {
  imports?: ParsedImport[];
}

interface TypeDepsPayload {
  dependencies?: TypedDependency[];
}

interface ExternalIndexPayload {
  indexedFiles: number;
  symbols: number;
}

interface ExternalSearchPayload {
  matches?: ExternalLibrarySymbol[];
}

type HoverResult = ResultWithError<HoverPayload>;

type ReferencesResult = ResultWithError<ReferencesPayload>;

type DefinitionsResult = ResultWithError<DefinitionsPayload>;

type DiagnosticsResult = ResultWithError<DiagnosticsPayload>;

type SymbolsResult = ResultWithError<SymbolsPayload>;

type CompletionResult = ResultWithError<CompletionPayload>;

type SignatureHelpResult = ResultWithError<SignatureHelpPayload>;

type FormatResult = ResultWithError<FormatPayload>;

type CodeActionsResult = ResultWithError<CodeActionsPayload>;

type RenameResult = ResultWithError<RenamePayload>;

type DeleteResult = ResultWithError<DeletePayload>;

type CapabilitiesResult = ResultWithError<CapabilitiesPayload>;

type ExternalSymbolsResult = ResultWithError<ExternalSymbolsPayload>;

type ParseImportsResult = ResultWithError<ParseImportsPayload>;

type TypeDepsResult = ResultWithError<TypeDepsPayload>;

type ExternalIndexResult = ResultWithError<ExternalIndexPayload>;

type ExternalSearchResult = ResultWithError<ExternalSearchPayload>;

interface LspDiagnosticProvider {
  workspaceDiagnostics?: boolean;
}

interface LspServerCapabilities {
  diagnosticProvider?: LspDiagnosticProvider;
}

interface LspInitializeResult {
  capabilities?: LspServerCapabilities;
}

interface WorkspaceDiagnosticsValuePayload {
  __unsupported?: boolean;
}

type WorkspaceDiagnosticsValue = WorkspaceDiagnosticsValuePayload | null;

interface DefinitionPreviewOptions {
  before?: number;
  after?: number;
  include_body?: boolean;
}

const resolveRootAbs = (root: string | undefined): string => {
  const cwd = process.cwd();

  if (!root || root.trim().length === 0) {
    return cwd;
  }

  const trimmed = root.trim();

  return path.isAbsolute(trimmed) ? trimmed : path.resolve(cwd, trimmed);
};

const resolveFileAbs = (rootAbs: string, filePath: string): string => {
  return path.isAbsolute(filePath) ? filePath : path.resolve(rootAbs, filePath);
};

const splitLines = (text: string): string[] => text.split(/\r?\n/);

const resolveLineNumber0 = (lines: string[], line: LineParam): number => {
  if (typeof line === 'number') {
    const idx = Math.max(0, Math.floor(line) - 1);

    return Math.min(lines.length > 0 ? lines.length - 1 : 0, idx);
  }

  // Numeric string: treat as 1-based line number (e.g. JSON "14" from MCP clients)
  const parsed = Number(line);

  if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
    const idx = Math.max(0, Math.floor(parsed) - 1);

    return Math.min(lines.length > 0 ? lines.length - 1 : 0, idx);
  }

  const needle = line;
  const idx = lines.findIndex(l => l.includes(needle));

  if (idx === -1) {
    throw new Error(`Line containing "${needle}" not found`);
  }

  return idx;
};

const NEARBY_SEARCH_RANGE = 5;

const findSymbolPosition = (lines: string[], lineIdx: number, symbolName: string): LspPosition => {
  // 1. Exact line (fast path)
  const exactCol = (lines[lineIdx] ?? '').indexOf(symbolName);

  if (exactCol !== -1) {
    return { line: lineIdx, character: exactCol };
  }

  // 2. Search nearby lines (±NEARBY_SEARCH_RANGE)
  for (let delta = 1; delta <= NEARBY_SEARCH_RANGE; delta++) {
    for (const d of [-delta, delta]) {
      const candidate = lineIdx + d;

      if (candidate < 0 || candidate >= lines.length) {
        continue;
      }

      const col = (lines[candidate] ?? '').indexOf(symbolName);

      if (col !== -1) {
        return { line: candidate, character: col };
      }
    }
  }

  // 3. Fallback: column 0 on original line (never throw)
  return { line: lineIdx, character: 0 };
};

const positionToOffset = (text: string, pos: LspPosition): number => {
  const lines = splitLines(text);
  const line = Math.max(0, Math.min(lines.length - 1, pos.line));
  let offset = 0;

  for (let i = 0; i < line; i++) {
    offset += (lines[i]?.length ?? 0) + 1; // +\n
  }

  const col = Math.max(0, Math.min(lines[line]?.length ?? 0, pos.character));

  return offset + col;
};

const applyTextEdits = (text: string, edits: ReadonlyArray<LspTextEdit>): string => {
  const withOffsets = edits.map(e => {
    const start = positionToOffset(text, e.range.start);
    const end = positionToOffset(text, e.range.end);

    return { start, end, newText: e.newText };
  });

  withOffsets.sort((a, b) => b.start - a.start || b.end - a.end);

  let out = text;

  for (const e of withOffsets) {
    out = out.slice(0, e.start) + e.newText + out.slice(e.end);
  }

  return out;
};

const readWithFallback = async (filePath: string): Promise<string> => {
  if (filePath.trim().length === 0) {
    return '';
  }

  try {
    return await Bun.file(filePath).text();
  } catch {
    return '';
  }
};

const withOpenDocument = async <T>(input: OpenDocumentInput, fn: (doc: OpenedDocument) => Promise<T>): Promise<T> => {
  const text = await Bun.file(input.fileAbs).text();
  const { uri } = await openTsDocument({
    lsp: input.lsp,
    filePath: input.fileAbs,
    ...(input.languageId !== undefined ? { languageId: input.languageId } : {}),
    text,
  });

  try {
    return await fn({ uri, text, lines: splitLines(text) });
  } finally {
    await input.lsp.notify('textDocument/didClose', { textDocument: { uri } }).catch(() => undefined);
  }
};

const isLspLocation = (value: unknown): value is LspLocation => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as UriRangeUnknownRecord;

  return typeof record.uri === 'string' && typeof record.range === 'object' && record.range !== null;
};

const normalizeLocations = (value: unknown): LspLocation[] => {
  const out: LspLocation[] = [];

  if (!value) {
    return out;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      if ('uri' in item && 'range' in item) {
        out.push(item);
      } else if ('targetUri' in item && 'targetRange' in item) {
        out.push({ uri: item.targetUri, range: item.targetRange });
      }
    }
  } else if (isLspLocation(value)) {
    out.push(value);
  }

  return out;
};

const previewRange = async (filePath: string, range: LspRange, before = 2, after = 2): Promise<string> => {
  const text = await readWithFallback(filePath);
  const lines = splitLines(text);
  const startLine = Math.max(0, range.start.line);
  const from = Math.max(0, startLine - before);
  const to = Math.min(lines.length - 1, startLine + after);
  const snippet = lines.slice(from, to + 1).join('\n');

  return snippet;
};

const getHoverUseCase = async (input: HoverInput): Promise<HoverResult> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.filePath);

  input.logger.debug('lsp:hover', { filePath: input.filePath, line: input.line, target: input.target });

  const result = await withTsgoLspSession<unknown>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
      return withOpenDocument({ lsp: session.lsp, fileAbs }, async doc => {
        if (doc.lines.length === 0) {
          return null;
        }

        const baseLineIdx = resolveLineNumber0(doc.lines, input.line);
        const pos =
          input.target !== undefined
            ? findSymbolPosition(doc.lines, baseLineIdx, input.target)
            : { line: baseLineIdx, character: input.character !== undefined ? Math.max(0, Math.floor(input.character)) : 0 };
        const hover = await session.lsp.request('textDocument/hover', {
          textDocument: { uri: doc.uri },
          position: { line: pos.line, character: pos.character },
        });

        return hover;
      });
    },
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, hover: result.value, ...(result.note !== undefined ? { note: result.note } : {}) };
};

const findReferencesUseCase = async (input: SymbolAtLineInput): Promise<ReferencesResult> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.filePath);

  input.logger.debug('lsp:references', { filePath: input.filePath, symbolName: input.symbolName });

  const result = await withTsgoLspSession<LspReference[]>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
      return withOpenDocument({ lsp: session.lsp, fileAbs }, async doc => {
        if (doc.lines.length === 0) {
          return [];
        }

        const baseLineIdx = resolveLineNumber0(doc.lines, input.line);
        const pos = findSymbolPosition(doc.lines, baseLineIdx, input.symbolName);
        const refs = await session.lsp.request<unknown>('textDocument/references', {
          textDocument: { uri: doc.uri },
          position: { line: pos.line, character: pos.character },
          context: { includeDeclaration: true },
        });
        const mapped: LspReference[] = [];
        const refItems = Array.isArray(refs) ? refs : [];

        for (const r of refItems) {
          if (!r || typeof r !== 'object') {
            continue;
          }

          const item = r as LocationLikeRecord;

          if (typeof item.uri !== 'string' || item.range === undefined) {
            continue;
          }

          const refPath = lspUriToFilePath(item.uri);
          const snippet = await previewRange(refPath, item.range, 0, 0);

          mapped.push({ filePath: refPath, range: item.range, ...(snippet.length > 0 ? { snippet: snippet.trim() } : {}) });
        }

        return mapped;
      });
    },
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, references: result.value };
};

const getDefinitionsUseCase = async (input: SymbolAtLineInput & DefinitionPreviewOptions): Promise<DefinitionsResult> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.filePath);

  input.logger.debug('lsp:definitions', { filePath: input.filePath, symbolName: input.symbolName });

  const result = await withTsgoLspSession<LspDefinition[]>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
      return withOpenDocument({ lsp: session.lsp, fileAbs }, async doc => {
        const baseLineIdx = resolveLineNumber0(doc.lines, input.line);
        const pos = findSymbolPosition(doc.lines, baseLineIdx, input.symbolName);
        const raw = await session.lsp.request('textDocument/definition', {
          textDocument: { uri: doc.uri },
          position: { line: pos.line, character: pos.character },
        });
        const locs = normalizeLocations(raw);
        const before = input.before ?? 2;
        const after = input.after ?? 2;
        const defs: LspDefinition[] = [];

        for (const loc of locs) {
          const defPath = lspUriToFilePath(loc.uri);
          const preview = await previewRange(defPath, loc.range, before, after);

          defs.push({ filePath: defPath, range: loc.range, preview });
        }

        return defs;
      });
    },
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, definitions: result.value };
};

const getDiagnosticsUseCase = async (input: DiagnosticsInput): Promise<DiagnosticsResult> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.filePath);

  input.logger.debug('lsp:diagnostics', { filePath: input.filePath });

  const result = await withTsgoLspSession<unknown>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
      return withOpenDocument({ lsp: session.lsp, fileAbs }, async doc => {
        // LSP 3.17 pull diagnostics (server dependent)
        const diagnostics = await session.lsp
          .request('textDocument/diagnostic', {
            textDocument: { uri: doc.uri },
            ...(input.forceRefresh ? { previousResultId: null } : {}),
          })
          .catch(() => null);

        return diagnostics;
      });
    },
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, diagnostics: result.value ?? [] };
};

const getAllDiagnosticsUseCase = async (input: RootInput): Promise<DiagnosticsResult> => {
  const rootAbs = resolveRootAbs(input.root);

  input.logger.debug('lsp:workspace-diagnostics');

  const result = await withTsgoLspSession<unknown>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
      // Check capabilities first — tsgo may not support workspace diagnostics.
      const init = session.initializeResult as LspInitializeResult;
      const diagCap = init?.capabilities?.diagnosticProvider;

      if (diagCap && diagCap.workspaceDiagnostics === false) {
        return { __unsupported: true };
      }

      // LSP 3.17 workspace diagnostics with timeout (server dependent)
      const diagnostics = await session.lsp.request('workspace/diagnostic', {}, 60_000).catch(() => null);

      return diagnostics;
    },
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const value = result.value as WorkspaceDiagnosticsValue;

  if (value && value.__unsupported) {
    return { ok: true, diagnostics: [] };
  }

  return { ok: true, diagnostics: value ?? [] };
};

const getDocumentSymbolsUseCase = async (input: FileInput): Promise<SymbolsResult> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.filePath);

  input.logger.debug('lsp:documentSymbols', { filePath: input.filePath });

  const result = await withTsgoLspSession<unknown>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
      return withOpenDocument({ lsp: session.lsp, fileAbs }, async doc => {
        return session.lsp.request('textDocument/documentSymbol', { textDocument: { uri: doc.uri } });
      });
    },
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, symbols: result.value };
};

const getWorkspaceSymbolsUseCase = async (input: RootInput & WorkspaceQueryInput): Promise<SymbolsResult> => {
  const rootAbs = resolveRootAbs(input.root);
  const query = input.query ?? '';

  input.logger.debug('lsp:workspaceSymbols', { query });

  const toWorkspaceSymbol = (match: SymbolMatch) => {
    const uri = Bun.pathToFileURL(match.filePath).toString();

    return {
      name: match.name,
      kind: match.kind,
      location: {
        uri,
        range: {
          start: { line: Math.max(0, match.span.start.line - 1), character: Math.max(0, match.span.start.column - 1) },
          end: { line: Math.max(0, match.span.end.line - 1), character: Math.max(0, match.span.end.column - 1) },
        },
      },
    };
  };

  const fallbackToIndex = async (): Promise<SymbolsResult> => {
    if (query.trim().length === 0) {
      return { ok: true, symbols: [] };
    }

    await indexSymbolsUseCase({ root: rootAbs, logger: input.logger });

    const matches = await searchSymbolFromIndexUseCase({ root: rootAbs, query, logger: input.logger });

    return { ok: true, symbols: matches.map(toWorkspaceSymbol) };
  };

  const result = await withTsgoLspSession<unknown>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
      return session.lsp.request('workspace/symbol', { query: input.query ?? '' });
    },
  );

  if (!result.ok) {
    return fallbackToIndex();
  }

  const symbols = Array.isArray(result.value) ? result.value : [];

  if (symbols.length === 0 && query.trim().length > 0) {
    return fallbackToIndex();
  }

  return { ok: true, symbols };
};

const getCompletionUseCase = async (input: CompletionInput): Promise<CompletionResult> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.filePath);

  input.logger.trace('lsp:completion', { filePath: input.filePath, line: input.line });

  const result = await withTsgoLspSession<unknown>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
      return withOpenDocument({ lsp: session.lsp, fileAbs }, async doc => {
        const lineIdx = resolveLineNumber0(doc.lines, input.line);
        const character0 =
          input.character !== undefined ? Math.max(0, Math.floor(input.character)) : (doc.lines[lineIdx]?.length ?? 0);

        return session.lsp.request('textDocument/completion', {
          textDocument: { uri: doc.uri },
          position: { line: lineIdx, character: character0 },
        });
      });
    },
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, completion: result.value };
};

const getSignatureHelpUseCase = async (input: SignatureHelpInput): Promise<SignatureHelpResult> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.filePath);

  input.logger.trace('lsp:signatureHelp', { filePath: input.filePath, line: input.line });

  const result = await withTsgoLspSession<unknown>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
      return withOpenDocument({ lsp: session.lsp, fileAbs }, async doc => {
        const lineIdx = resolveLineNumber0(doc.lines, input.line);
        const character0 =
          input.character !== undefined ? Math.max(0, Math.floor(input.character)) : (doc.lines[lineIdx]?.length ?? 0);

        return session.lsp.request('textDocument/signatureHelp', {
          textDocument: { uri: doc.uri },
          position: { line: lineIdx, character: character0 },
        });
      });
    },
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, signatureHelp: result.value };
};

const formatDocumentUseCase = async (input: FileInput): Promise<FormatResult> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.filePath);

  input.logger.debug('lsp:formatDocument', { filePath: input.filePath });

  const result = await withTsgoLspSession<LspChangedResult>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
      return withOpenDocument({ lsp: session.lsp, fileAbs }, async doc => {
        const edits = await session.lsp
          .request<LspTextEdit[]>('textDocument/formatting', {
            textDocument: { uri: doc.uri },
            options: { tabSize: 2, insertSpaces: true },
          })
          .catch(() => null);

        if (!edits || edits.length === 0) {
          return { changed: false };
        }

        const nextText = applyTextEdits(doc.text, edits);

        if (nextText === doc.text) {
          return { changed: false };
        }

        await Bun.write(fileAbs, nextText);

        return { changed: true };
      });
    },
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, changed: result.value.changed };
};

const getCodeActionsUseCase = async (input: CodeActionsInput): Promise<CodeActionsResult> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.filePath);

  input.logger.debug('lsp:codeActions', { filePath: input.filePath, startLine: input.startLine });

  const result = await withTsgoLspSession<unknown>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
      return withOpenDocument({ lsp: session.lsp, fileAbs }, async doc => {
        const startLineIdx = resolveLineNumber0(doc.lines, input.startLine);
        const endLineIdx = input.endLine !== undefined ? resolveLineNumber0(doc.lines, input.endLine) : startLineIdx;
        const range: LspRange = {
          start: { line: startLineIdx, character: 0 },
          end: { line: endLineIdx, character: doc.lines[endLineIdx]?.length ?? 0 },
        };
        const actions = await session.lsp.request('textDocument/codeAction', {
          textDocument: { uri: doc.uri },
          range,
          context: { diagnostics: [] },
        });

        if (!input.includeKinds || input.includeKinds.length === 0) {
          return actions;
        }

        // Best-effort filter for CodeAction objects.
        if (!Array.isArray(actions)) {
          return actions;
        }

        return actions.filter(action => {
          if (!action || typeof action !== 'object') {
            return false;
          }

          const record = action as ActionKindRecord;
          const kind = typeof record.kind === 'string' ? record.kind : '';
          const includeKinds = input.includeKinds;

          if (!includeKinds) {
            return false;
          }

          return includeKinds.some(k => kind.startsWith(k));
        });
      });
    },
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, actions: result.value };
};

const applyWorkspaceEditToDisk = async (edit: WorkspaceEdit): Promise<LspChangedFilesResult> => {
  const changedFiles: string[] = [];
  const changes = edit.changes ?? {};

  if (Object.keys(changes).length === 0) {
    return { changedFiles };
  }

  for (const [uri, edits] of Object.entries(changes)) {
    const filePath = lspUriToFilePath(uri);
    const prevText = await Bun.file(filePath).text();
    const nextText = applyTextEdits(prevText, edits);

    if (nextText !== prevText) {
      await Bun.write(filePath, nextText);
      changedFiles.push(filePath);
    }
  }

  return { changedFiles };
};

const renameSymbolUseCase = async (input: RenameInput): Promise<RenameResult> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.filePath);

  input.logger.debug('lsp:rename', { filePath: input.filePath, symbolName: input.symbolName, newName: input.newName });

  const result = await withTsgoLspSession<LspChangedFilesResult>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
      return withOpenDocument({ lsp: session.lsp, fileAbs }, async doc => {
        let pos: LspPosition;

        if (input.line !== undefined) {
          const baseLineIdx = resolveLineNumber0(doc.lines, input.line);

          pos = findSymbolPosition(doc.lines, baseLineIdx, input.symbolName);
        } else {
          // Find first occurrence in file
          const idx = doc.lines.findIndex(l => l.includes(input.symbolName));

          if (idx === -1) {
            throw new Error(`Symbol "${input.symbolName}" not found in file`);
          }

          pos = { line: idx, character: (doc.lines[idx] ?? '').indexOf(input.symbolName) };
        }

        const edit = await session.lsp.request<WorkspaceEdit | null>('textDocument/rename', {
          textDocument: { uri: doc.uri },
          position: { line: pos.line, character: pos.character },
          newName: input.newName,
        });

        if (!edit) {
          return { changedFiles: [] };
        }

        const { changedFiles } = await applyWorkspaceEditToDisk(edit);

        return { changedFiles };
      });
    },
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, changedFiles: result.value.changedFiles };
};

const deleteSymbolUseCase = async (input: DeleteInput): Promise<DeleteResult> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.filePath);

  input.logger.debug('lsp:deleteSymbol', { filePath: input.filePath, symbolName: input.symbolName });

  const result = await withTsgoLspSession<LspChangedResult>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
      return withOpenDocument({ lsp: session.lsp, fileAbs }, async doc => {
        const baseLineIdx = resolveLineNumber0(doc.lines, input.line);
        const pos = findSymbolPosition(doc.lines, baseLineIdx, input.symbolName);
        const raw = await session.lsp
          .request('textDocument/definition', {
            textDocument: { uri: doc.uri },
            position: { line: pos.line, character: pos.character },
          })
          .catch(() => null);
        const locs = normalizeLocations(raw);
        const loc = locs[0];

        if (!loc) {
          return { changed: false };
        }

        const defPath = lspUriToFilePath(loc.uri);
        const defText = await Bun.file(defPath).text();
        // Coarse delete: remove the full lines covered by the definition range.
        const defLines = splitLines(defText);
        const from = Math.max(0, loc.range.start.line);
        const to = Math.min(defLines.length - 1, loc.range.end.line);
        const nextLines = defLines.slice(0, from).concat(defLines.slice(to + 1));
        const nextText = nextLines.join('\n');

        if (nextText === defText) {
          return { changed: false };
        }

        await Bun.write(defPath, nextText);

        return { changed: true };
      });
    },
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, changed: result.value.changed };
};

const checkCapabilitiesUseCase = async (input: RootInput): Promise<CapabilitiesResult> => {
  const rootAbs = resolveRootAbs(input.root);

  input.logger.debug('lsp:checkCapabilities');

  const result = await withTsgoLspSession<unknown>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
      const init = session.initializeResult as InitializeResultLike | null;

      return init?.capabilities ?? init ?? null;
    },
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, capabilities: result.value, ...(result.note ? { note: result.note } : {}) };
};

const getAvailableExternalSymbolsInFileUseCase = async (input: ExternalSymbolsInput): Promise<ExternalSymbolsResult> => {
  if (input.filePath.trim().length === 0) {
    return { ok: false, symbols: [], error: 'File path is required' };
  }

  try {
    const rootAbs = resolveRootAbs(input.root);
    const fileAbs = resolveFileAbs(rootAbs, input.filePath);
    const text = await Bun.file(fileAbs).text();
    const lines = splitLines(text);
    const out = new Set<string>();
    // Very small import parser: import { A, B as C } from 'x'
    const importNamed = /import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/g;

    for (const line of lines) {
      const m = importNamed.exec(line);

      if (m) {
        const inner = m[1] ?? '';

        for (const part of inner.split(',')) {
          const trimmed = part.trim();

          if (trimmed.length === 0) {
            continue;
          }

          const [orig, alias] = trimmed.split(/\s+as\s+/i);

          out.add((alias ?? orig ?? '').trim());
        }
      }

      importNamed.lastIndex = 0;

      const defaultImport = /import\s+([A-Za-z_$][\w$]*)\s+from\s*['"][^'"]+['"]/;
      const d = defaultImport.exec(line);

      if (d?.[1]) {
        out.add(d[1]);
      }

      const nsImport = /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"][^'"]+['"]/;
      const n = nsImport.exec(line);

      if (n?.[1]) {
        out.add(n[1]);
      }
    }

    return { ok: true, symbols: Array.from(out).sort((a, b) => a.localeCompare(b)) };
  } catch (error) {
    return { ok: false, symbols: [], error: error instanceof Error ? error.message : String(error) };
  }
};

const parseImportsUseCase = async (input: ParseImportsInput): Promise<ParseImportsResult> => {
  if (input.filePath.trim().length === 0) {
    return { ok: false, error: 'File path is required' };
  }

  try {
    const rootAbs = resolveRootAbs(input.root);
    const fileAbs = resolveFileAbs(rootAbs, input.filePath);
    const text = await Bun.file(fileAbs).text();
    const imports: ParsedImport[] = [];
    const re = /(import|export)\s+(?:type\s+)?[^;\n]*?from\s*['"]([^'"]+)['"][^\n;]*;?/g;

    const extractNames = (raw: string): string[] => {
      const names: string[] = [];
      const namedMatch = /\{([^}]+)\}/.exec(raw);

      if (namedMatch?.[1]) {
        for (const part of namedMatch[1].split(',')) {
          const trimmed = part.trim();

          if (trimmed.length === 0) {
            continue;
          }

          const [orig, alias] = trimmed.split(/\s+as\s+/i);

          names.push((alias ?? orig ?? '').trim());
        }
      }

      const nsMatch = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(raw);

      if (nsMatch?.[1]) {
        names.push(nsMatch[1]);
      }

      const defaultMatch = /import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/.exec(raw);

      if (defaultMatch?.[1] && !names.includes(defaultMatch[1])) {
        names.push(defaultMatch[1]);
      }

      return names.filter(name => name.length > 0);
    };

    for (const m of text.matchAll(re)) {
      const spec = m[2] ?? '';
      const raw = m[0] ?? '';
      const names = extractNames(raw);

      imports.push({ kind: m[1] ?? 'import', specifier: spec, raw, names, resolvedPath: null });
    }

    // Resolve relative specifiers
    for (const item of imports) {
      if (item.specifier.startsWith('.') || item.specifier.startsWith('/')) {
        const base = path.dirname(fileAbs);
        const abs = path.resolve(base, item.specifier);

        item.resolvedPath = abs;
      }
    }

    return { ok: true, imports };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

const getTypescriptDependenciesUseCase = async (input: TypeDepsInput): Promise<TypeDepsResult> => {
  const rootAbs = resolveRootAbs(input.root);

  input.logger.debug('lsp:typescriptDependencies', { root: rootAbs });

  const pkgPath = path.resolve(rootAbs, 'package.json');
  const pkgText = await readWithFallback(pkgPath);

  if (pkgText.length === 0) {
    return { ok: false, error: `package.json not found at ${pkgPath}` };
  }

  try {
    const pkg = JSON.parse(pkgText);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
    const names = Object.keys(deps).sort((a, b) => a.localeCompare(b));
    const withTypes: TypedDependency[] = [];

    for (const name of names) {
      const depPkgPath = path.resolve(rootAbs, 'node_modules', name, 'package.json');
      const depPkgText = await readWithFallback(depPkgPath);

      if (depPkgText.length === 0) {
        continue;
      }

      try {
        const depPkg = JSON.parse(depPkgText);
        const installedVersion = typeof depPkg.version === 'string' ? depPkg.version : (deps[name] ?? 'unknown');
        const typesField = (depPkg.types ?? depPkg.typings) as string | undefined;

        if (typesField) {
          withTypes.push({ name, version: installedVersion, hasTypes: true });

          continue;
        }

        // Heuristic: common d.ts entrypoints
        const candidate = path.resolve(rootAbs, 'node_modules', name, 'index.d.ts');
        const candidateText = await readWithFallback(candidate);

        if (candidateText.length > 0) {
          withTypes.push({ name, version: installedVersion, hasTypes: true });

          continue;
        }
      } catch {
        continue;
      }
    }

    return { ok: true, dependencies: withTypes };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

const externalIndex = new Map<string, ExternalLibrarySymbol[]>();

const indexExternalLibrariesUseCase = async (input: ExternalIndexInput): Promise<ExternalIndexResult> => {
  const rootAbs = resolveRootAbs(input.root);

  if (rootAbs.trim().length === 0) {
    return { ok: false, indexedFiles: 0, symbols: 0, error: 'Root is required' };
  }

  try {
    const maxFiles = input.maxFiles && input.maxFiles > 0 ? Math.min(50_000, Math.floor(input.maxFiles)) : 10_000;

    input.logger.debug('lsp:indexExternalLibraries', { root: rootAbs, maxFiles });

    const include =
      input.includePatterns && input.includePatterns.length > 0 ? input.includePatterns : ['node_modules/**/*.d.ts'];
    const exclude = new Set(input.excludePatterns ?? ['**/node_modules/**/node_modules/**']);
    const entries: ExternalLibrarySymbol[] = [];
    let seenFiles = 0;

    for (const pattern of include) {
      const glob = new Bun.Glob(pattern);

      for await (const rel of glob.scan({ cwd: rootAbs, onlyFiles: true, followSymlinks: false })) {
        if (seenFiles >= maxFiles) {
          break;
        }

        // Best-effort exclude check (string contains based)
        if (Array.from(exclude).some(ex => rel.includes(ex.replaceAll('*', '')))) {
          continue;
        }

        const filePath = path.resolve(rootAbs, rel);
        const text = await readWithFallback(filePath);

        if (text.length === 0) {
          continue;
        }

        const parts = rel.split(path.sep);
        const nmIdx = parts.lastIndexOf('node_modules');
        const library = nmIdx >= 0 ? (parts[nmIdx + 1] ?? 'unknown') : 'unknown';
        const lines = splitLines(text);

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? '';
          const m = /\b(export\s+)?(declare\s+)?(class|interface|type|enum|function|const|let|var)\s+([A-Za-z_$][\w$]*)\b/.exec(
            line,
          );

          if (m?.[4]) {
            entries.push({ library, kind: m[3] ?? 'unknown', symbolName: m[4], filePath, line: i + 1 });
          }
        }

        seenFiles += 1;
      }
      if (seenFiles >= maxFiles) {
        break;
      }
    }

    externalIndex.set(rootAbs, entries);

    return { ok: true, indexedFiles: seenFiles, symbols: entries.length };
  } catch (error) {
    return { ok: false, indexedFiles: 0, symbols: 0, error: error instanceof Error ? error.message : String(error) };
  }
};

const searchExternalLibrarySymbolsUseCase = async (input: ExternalSearchInput): Promise<ExternalSearchResult> => {
  const rootAbs = resolveRootAbs(input.root);
  const entries = externalIndex.get(rootAbs) ?? [];

  if (entries.length === 0) {
    return { ok: true, matches: [] };
  }

  try {
    const limit = input.limit && input.limit > 0 ? Math.min(500, Math.floor(input.limit)) : 50;
    const lib = (input.libraryName ?? '').toLowerCase();
    const sym = (input.symbolName ?? '').toLowerCase();
    const kind = (input.kind ?? '').toLowerCase();
    const filtered = entries.filter(e => {
      const libOk = !lib || e.library.toLowerCase().includes(lib);
      const symOk = !sym || e.symbolName.toLowerCase().includes(sym);
      const kindOk = !kind || e.kind.toLowerCase().includes(kind);

      return libOk && symOk && kindOk;
    });

    return { ok: true, matches: filtered.slice(0, limit) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

export {
  checkCapabilitiesUseCase,
  deleteSymbolUseCase,
  findReferencesUseCase,
  formatDocumentUseCase,
  getAllDiagnosticsUseCase,
  getAvailableExternalSymbolsInFileUseCase,
  getCodeActionsUseCase,
  getCompletionUseCase,
  getDefinitionsUseCase,
  getDiagnosticsUseCase,
  getDocumentSymbolsUseCase,
  getHoverUseCase,
  getSignatureHelpUseCase,
  getTypescriptDependenciesUseCase,
  getWorkspaceSymbolsUseCase,
  indexExternalLibrariesUseCase,
  parseImportsUseCase,
  renameSymbolUseCase,
  searchExternalLibrarySymbolsUseCase,
};
