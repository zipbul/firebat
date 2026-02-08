import * as path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

import { openTsDocument, withTsgoLspSession, lspUriToFilePath } from '../../infrastructure/tsgo/tsgo-runner';
import type { FirebatLogger } from '../../ports/logger';

type LineParam = number | string;

type LspPosition = { line: number; character: number };

type LspRange = { start: LspPosition; end: LspPosition };

type LspTextEdit = { range: LspRange; newText: string };

type WorkspaceEdit = {
  changes?: Record<string, LspTextEdit[]>;
  documentChanges?: any;
};

const resolveRootAbs = (root: string | undefined): string => {
  const cwd = process.cwd();

  if (!root || root.trim().length === 0) {return cwd;}

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

  const needle = line;
  const idx = lines.findIndex(l => l.includes(needle));

  if (idx === -1) {
    throw new Error(`Line containing "${needle}" not found`);
  }

  return idx;
};

const NEARBY_SEARCH_RANGE = 5;

const findSymbolPosition = (
  lines: string[],
  lineIdx: number,
  symbolName: string,
): { line: number; character: number } => {
  // 1. Exact line (fast path)
  const exactCol = (lines[lineIdx] ?? '').indexOf(symbolName);

  if (exactCol !== -1) {
    return { line: lineIdx, character: exactCol };
  }

  // 2. Search nearby lines (±NEARBY_SEARCH_RANGE)
  for (let delta = 1; delta <= NEARBY_SEARCH_RANGE; delta++) {
    for (const d of [-delta, delta]) {
      const candidate = lineIdx + d;

      if (candidate < 0 || candidate >= lines.length) {continue;}

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

  const col = Math.max(0, Math.min((lines[line]?.length ?? 0), pos.character));

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
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return '';
  }
};

const withOpenDocument = async <T>(
  input: { lsp: any; fileAbs: string; languageId?: string },
  fn: (doc: { uri: string; text: string; lines: string[] }) => Promise<T>,
): Promise<T> => {
  const text = await readFile(input.fileAbs, 'utf8');
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

const normalizeLocations = (value: unknown): Array<{ uri: string; range: LspRange }> => {
  if (!value) {return [];}

  if (Array.isArray(value)) {
    const out: Array<{ uri: string; range: LspRange }> = [];

    for (const item of value) {
      if (!item || typeof item !== 'object') {continue;}

      if ('uri' in (item) && 'range' in (item)) {
        out.push(item);
      } else if ('targetUri' in (item) && 'targetRange' in (item)) {
        out.push({ uri: (item).targetUri, range: (item).targetRange });
      }
    }

    return out;
  }

  if (typeof value === 'object' && value && 'uri' in (value as any) && 'range' in (value as any)) {
    return [value as any];
  }

  return [];
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

export const getHoverUseCase = async (input: {
  root: string;
  filePath: string;
  line: LineParam;
  character?: number;
  target?: string;
  tsconfigPath?: string;
  logger: FirebatLogger;
}): Promise<{ ok: boolean; hover?: unknown; error?: string; note?: string }> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.filePath);

  input.logger.debug('lsp:hover', { filePath: input.filePath, line: input.line, target: input.target });

  const result = await withTsgoLspSession<unknown>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
    return  withOpenDocument({ lsp: session.lsp, fileAbs }, async doc => {
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

  if (!result.ok) {return { ok: false, error: result.error };}

  return { ok: true, hover: result.value, ...(result.note !== undefined ? { note: result.note } : {}) };
};

export const findReferencesUseCase = async (input: {
  root: string;
  filePath: string;
  line: LineParam;
  symbolName: string;
  tsconfigPath?: string;
  logger: FirebatLogger;
}): Promise<{ ok: boolean; references?: Array<{ filePath: string; range: LspRange; snippet?: string }>; error?: string }> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.filePath);

  input.logger.debug('lsp:references', { filePath: input.filePath, symbolName: input.symbolName });

  const result = await withTsgoLspSession<Array<{ filePath: string; range: LspRange; snippet?: string }>>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
    return  withOpenDocument({ lsp: session.lsp, fileAbs }, async doc => {
      const baseLineIdx = resolveLineNumber0(doc.lines, input.line);
      const pos = findSymbolPosition(doc.lines, baseLineIdx, input.symbolName);
      const refs = await session.lsp.request<any[]>('textDocument/references', {
        textDocument: { uri: doc.uri },
        position: { line: pos.line, character: pos.character },
        context: { includeDeclaration: true },
      });

      const mapped: Array<{ filePath: string; range: LspRange; snippet?: string }> = [];

      for (const r of refs ?? []) {
        const refPath = lspUriToFilePath(r.uri);
        const snippet = await previewRange(refPath, r.range, 0, 0);

        mapped.push({ filePath: refPath, range: r.range, ...(snippet.length > 0 ? { snippet: snippet.trim() } : {}) });
      }

      return mapped;
    });
    },
  );

  if (!result.ok) {return { ok: false, error: result.error };}

  return { ok: true, references: result.value };
};

export const getDefinitionsUseCase = async (input: {
  root: string;
  filePath: string;
  line: LineParam;
  symbolName: string;
  before?: number;
  after?: number;
  include_body?: boolean;
  tsconfigPath?: string;
  logger: FirebatLogger;
}): Promise<{ ok: boolean; definitions?: Array<{ filePath: string; range: LspRange; preview?: string }>; error?: string }> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.filePath);

  input.logger.debug('lsp:definitions', { filePath: input.filePath, symbolName: input.symbolName });

  const result = await withTsgoLspSession<Array<{ filePath: string; range: LspRange; preview?: string }>>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
    return  withOpenDocument({ lsp: session.lsp, fileAbs }, async doc => {
      const baseLineIdx = resolveLineNumber0(doc.lines, input.line);
      const pos = findSymbolPosition(doc.lines, baseLineIdx, input.symbolName);
      const raw = await session.lsp.request('textDocument/definition', {
        textDocument: { uri: doc.uri },
        position: { line: pos.line, character: pos.character },
      });
      const locs = normalizeLocations(raw);
      const before = input.before ?? 2;
      const after = input.after ?? 2;
      const defs: Array<{ filePath: string; range: LspRange; preview?: string }> = [];

      for (const loc of locs) {
        const defPath = lspUriToFilePath(loc.uri);
        const preview = await previewRange(defPath, loc.range, before, after);

        defs.push({ filePath: defPath, range: loc.range, preview });
      }

      return defs;
    });
    },
  );

  if (!result.ok) {return { ok: false, error: result.error };}

  return { ok: true, definitions: result.value };
};

export const getDiagnosticsUseCase = async (input: {
  root: string;
  filePath: string;
  timeoutMs?: number;
  forceRefresh?: boolean;
  tsconfigPath?: string;
  logger: FirebatLogger;
}): Promise<{ ok: boolean; diagnostics?: unknown; error?: string }> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.filePath);

  input.logger.debug('lsp:diagnostics', { filePath: input.filePath });

  const result = await withTsgoLspSession<unknown>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
    return  withOpenDocument({ lsp: session.lsp, fileAbs }, async doc => {
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

  if (!result.ok) {return { ok: false, error: result.error };}

  return { ok: true, diagnostics: result.value ?? [] };
};

export const getAllDiagnosticsUseCase = async (input: {
  root: string;
  tsconfigPath?: string;
  logger: FirebatLogger;
}): Promise<{ ok: boolean; diagnostics?: unknown; error?: string }> => {
  const rootAbs = resolveRootAbs(input.root);

  input.logger.debug('lsp:workspace-diagnostics');

  const result = await withTsgoLspSession<unknown>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
    // Check capabilities first — tsgo may not support workspace diagnostics.
    const init = session.initializeResult as any;
    const diagCap = init?.capabilities?.diagnosticProvider;
    if (diagCap && diagCap.workspaceDiagnostics === false) {
      return { __unsupported: true };
    }

    // LSP 3.17 workspace diagnostics with timeout (server dependent)
    const diagnostics = await session.lsp.request('workspace/diagnostic', {}, 60_000).catch(() => null);

    return diagnostics;
    },
  );

  if (!result.ok) {return { ok: false, error: result.error };}

  const value = result.value as any;
  if (value && value.__unsupported) {
    return { ok: false, error: 'Workspace diagnostics not supported by the current tsgo LSP server (workspaceDiagnostics: false). Use get_diagnostics for individual files instead.' };
  }

  return { ok: true, diagnostics: value ?? [] };
};

export const getDocumentSymbolsUseCase = async (input: {
  root: string;
  filePath: string;
  tsconfigPath?: string;
  logger: FirebatLogger;
}): Promise<{ ok: boolean; symbols?: unknown; error?: string }> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.filePath);

  input.logger.debug('lsp:documentSymbols', { filePath: input.filePath });

  const result = await withTsgoLspSession<unknown>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
    return  withOpenDocument({ lsp: session.lsp, fileAbs }, async doc => {
      return  session.lsp.request('textDocument/documentSymbol', { textDocument: { uri: doc.uri } });
    });
    },
  );

  if (!result.ok) {return { ok: false, error: result.error };}

  return { ok: true, symbols: result.value };
};

export const getWorkspaceSymbolsUseCase = async (input: {
  root: string;
  query?: string;
  tsconfigPath?: string;
  logger: FirebatLogger;
}): Promise<{ ok: boolean; symbols?: unknown; error?: string }> => {
  const rootAbs = resolveRootAbs(input.root);

  input.logger.debug('lsp:workspaceSymbols', { query: input.query });

  const result = await withTsgoLspSession<unknown>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
    return  session.lsp.request('workspace/symbol', { query: input.query ?? '' });
    },
  );

  if (!result.ok) {return { ok: false, error: result.error };}

  return { ok: true, symbols: result.value };
};

export const getCompletionUseCase = async (input: {
  root: string;
  filePath: string;
  line: LineParam;
  character?: number;
  tsconfigPath?: string;
  logger: FirebatLogger;
}): Promise<{ ok: boolean; completion?: unknown; error?: string }> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.filePath);

  input.logger.trace('lsp:completion', { filePath: input.filePath, line: input.line });

  const result = await withTsgoLspSession<unknown>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
    return  withOpenDocument({ lsp: session.lsp, fileAbs }, async doc => {
      const lineIdx = resolveLineNumber0(doc.lines, input.line);
      const character0 = input.character !== undefined ? Math.max(0, Math.floor(input.character)) : (doc.lines[lineIdx]?.length ?? 0);

      return  session.lsp.request('textDocument/completion', {
        textDocument: { uri: doc.uri },
        position: { line: lineIdx, character: character0 },
      });
    });
    },
  );

  if (!result.ok) {return { ok: false, error: result.error };}

  return { ok: true, completion: result.value };
};

export const getSignatureHelpUseCase = async (input: {
  root: string;
  filePath: string;
  line: LineParam;
  character?: number;
  tsconfigPath?: string;
  logger: FirebatLogger;
}): Promise<{ ok: boolean; signatureHelp?: unknown; error?: string }> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.filePath);

  input.logger.trace('lsp:signatureHelp', { filePath: input.filePath, line: input.line });

  const result = await withTsgoLspSession<unknown>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
    return  withOpenDocument({ lsp: session.lsp, fileAbs }, async doc => {
      const lineIdx = resolveLineNumber0(doc.lines, input.line);
      const character0 = input.character !== undefined ? Math.max(0, Math.floor(input.character)) : (doc.lines[lineIdx]?.length ?? 0);

      return  session.lsp.request('textDocument/signatureHelp', {
        textDocument: { uri: doc.uri },
        position: { line: lineIdx, character: character0 },
      });
    });
    },
  );

  if (!result.ok) {return { ok: false, error: result.error };}

  return { ok: true, signatureHelp: result.value };
};

export const formatDocumentUseCase = async (input: {
  root: string;
  filePath: string;
  tsconfigPath?: string;
  logger: FirebatLogger;
}): Promise<{ ok: boolean; changed?: boolean; error?: string }> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.filePath);

  input.logger.debug('lsp:formatDocument', { filePath: input.filePath });

  const result = await withTsgoLspSession<{ changed: boolean }>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
    return  withOpenDocument({ lsp: session.lsp, fileAbs }, async doc => {
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

      if (nextText === doc.text) {return { changed: false };}

      await writeFile(fileAbs, nextText, 'utf8');

      return { changed: true };
    });
    },
  );

  if (!result.ok) {return { ok: false, error: result.error };}

  return { ok: true, changed: result.value.changed };
};

export const getCodeActionsUseCase = async (input: {
  root: string;
  filePath: string;
  startLine: LineParam;
  endLine?: LineParam;
  includeKinds?: ReadonlyArray<string>;
  tsconfigPath?: string;
  logger: FirebatLogger;
}): Promise<{ ok: boolean; actions?: unknown; error?: string }> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.filePath);

  input.logger.debug('lsp:codeActions', { filePath: input.filePath, startLine: input.startLine });

  const result = await withTsgoLspSession<unknown>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
    return  withOpenDocument({ lsp: session.lsp, fileAbs }, async doc => {
      const startLineIdx = resolveLineNumber0(doc.lines, input.startLine);
      const endLineIdx = input.endLine !== undefined ? resolveLineNumber0(doc.lines, input.endLine) : startLineIdx;
      const range: LspRange = {
        start: { line: startLineIdx, character: 0 },
        end: { line: endLineIdx, character: (doc.lines[endLineIdx]?.length ?? 0) },
      };
      const actions = await session.lsp.request('textDocument/codeAction', {
        textDocument: { uri: doc.uri },
        range,
        context: { diagnostics: [] },
      });

      if (!input.includeKinds || input.includeKinds.length === 0) {return actions;}

      // Best-effort filter for CodeAction objects.
      if (!Array.isArray(actions)) {return actions;}

      return actions.filter((a: any) => {
        const kind = typeof a?.kind === 'string' ? a.kind : '';

        return input.includeKinds!.some(k => kind.startsWith(k));
      });
    });
    },
  );

  if (!result.ok) {return { ok: false, error: result.error };}

  return { ok: true, actions: result.value };
};

const applyWorkspaceEditToDisk = async (edit: WorkspaceEdit): Promise<{ changedFiles: string[] }> => {
  const changedFiles: string[] = [];
  const changes = edit.changes ?? {};

  for (const [uri, edits] of Object.entries(changes)) {
    const filePath = lspUriToFilePath(uri);
    const prevText = await readFile(filePath, 'utf8');
    const nextText = applyTextEdits(prevText, edits);

    if (nextText !== prevText) {
      await writeFile(filePath, nextText, 'utf8');
      changedFiles.push(filePath);
    }
  }

  return { changedFiles };
};

export const renameSymbolUseCase = async (input: {
  root: string;
  filePath: string;
  line?: LineParam;
  symbolName: string;
  newName: string;
  tsconfigPath?: string;
  logger: FirebatLogger;
}): Promise<{ ok: boolean; changedFiles?: string[]; error?: string }> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.filePath);

  input.logger.debug('lsp:rename', { filePath: input.filePath, symbolName: input.symbolName, newName: input.newName });

  const result = await withTsgoLspSession<{ changedFiles: string[] }>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
    return  withOpenDocument({ lsp: session.lsp, fileAbs }, async doc => {
      let pos: { line: number; character: number };

      if (input.line !== undefined) {
        const baseLineIdx = resolveLineNumber0(doc.lines, input.line);

        pos = findSymbolPosition(doc.lines, baseLineIdx, input.symbolName);
      } else {
        // Find first occurrence in file
        const idx = doc.lines.findIndex(l => l.includes(input.symbolName));

        if (idx === -1) {throw new Error(`Symbol "${input.symbolName}" not found in file`);}

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

  if (!result.ok) {return { ok: false, error: result.error };}

  return { ok: true, changedFiles: result.value.changedFiles };
};

export const deleteSymbolUseCase = async (input: {
  root: string;
  filePath: string;
  line: LineParam;
  symbolName: string;
  tsconfigPath?: string;
  logger: FirebatLogger;
}): Promise<{ ok: boolean; changed?: boolean; error?: string }> => {
  const rootAbs = resolveRootAbs(input.root);
  const fileAbs = resolveFileAbs(rootAbs, input.filePath);

  input.logger.debug('lsp:deleteSymbol', { filePath: input.filePath, symbolName: input.symbolName });

  const result = await withTsgoLspSession<{ changed: boolean }>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
    return  withOpenDocument({ lsp: session.lsp, fileAbs }, async doc => {
      const baseLineIdx = resolveLineNumber0(doc.lines, input.line);
      const pos = findSymbolPosition(doc.lines, baseLineIdx, input.symbolName);
      const raw = await session.lsp
        .request('textDocument/definition', {
          textDocument: { uri: doc.uri },
          position: { line: pos.line, character: pos.character },
        })
        .catch(() => null);
      const locs = normalizeLocations(raw);

      if (locs.length === 0) {
        return { changed: false };
      }

      const loc = locs[0]!;
      const defPath = lspUriToFilePath(loc.uri);
      const defText = await readFile(defPath, 'utf8');
      // Coarse delete: remove the full lines covered by the definition range.
      const defLines = splitLines(defText);
      const from = Math.max(0, loc.range.start.line);
      const to = Math.min(defLines.length - 1, loc.range.end.line);
      const nextLines = defLines.slice(0, from).concat(defLines.slice(to + 1));
      const nextText = nextLines.join('\n');

      if (nextText === defText) {return { changed: false };}

      await writeFile(defPath, nextText, 'utf8');

      return { changed: true };
    });
    },
  );

  if (!result.ok) {return { ok: false, error: result.error };}

  return { ok: true, changed: result.value.changed };
};

export const checkCapabilitiesUseCase = async (input: {
  root: string;
  tsconfigPath?: string;
  logger: FirebatLogger;
}): Promise<{ ok: boolean; capabilities?: unknown; error?: string; note?: string }> => {
  const rootAbs = resolveRootAbs(input.root);

  input.logger.debug('lsp:checkCapabilities');

  const result = await withTsgoLspSession<unknown>(
    { root: rootAbs, logger: input.logger, ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}) },
    async session => {
    const init = session.initializeResult as any;

    return init?.capabilities ?? init ?? null;
    },
  );

  if (!result.ok) {return { ok: false, error: result.error };}

  return { ok: true, capabilities: result.value, ...(result.note ? { note: result.note } : {}) };
};

export const getAvailableExternalSymbolsInFileUseCase = async (input: {
  root: string;
  filePath: string;
}): Promise<{ ok: boolean; symbols: string[]; error?: string }> => {
  try {
    const rootAbs = resolveRootAbs(input.root);
    const fileAbs = resolveFileAbs(rootAbs, input.filePath);
    const text = await readFile(fileAbs, 'utf8');
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

          if (trimmed.length === 0) {continue;}

          const [orig, alias] = trimmed.split(/\s+as\s+/i);

          out.add((alias ?? orig ?? '').trim());
        }
      }

      importNamed.lastIndex = 0;

      const defaultImport = /import\s+([A-Za-z_$][\w$]*)\s+from\s*['"][^'"]+['"]/;
      const d = defaultImport.exec(line);

      if (d?.[1]) {out.add(d[1]);}

      const nsImport = /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"][^'"]+['"]/;
      const n = nsImport.exec(line);

      if (n?.[1]) {out.add(n[1]);}
    }

    return { ok: true, symbols: Array.from(out).sort((a, b) => a.localeCompare(b)) };
  } catch (error) {
    return { ok: false, symbols: [], error: error instanceof Error ? error.message : String(error) };
  }
};

export const parseImportsUseCase = async (input: {
  root: string;
  filePath: string;
}): Promise<{ ok: boolean; imports?: any; error?: string }> => {
  try {
    const rootAbs = resolveRootAbs(input.root);
    const fileAbs = resolveFileAbs(rootAbs, input.filePath);
    const text = await readFile(fileAbs, 'utf8');
    const imports: Array<{ kind: string; specifier: string; raw: string; resolvedPath?: string | null }> = [];
    const re = /(import|export)\s+(?:type\s+)?[^;\n]*?from\s*['"]([^'"]+)['"][^\n;]*;?/g;

    for (const m of text.matchAll(re)) {
      const spec = m[2] ?? '';
      const raw = m[0] ?? '';

      imports.push({ kind: m[1] ?? 'import', specifier: spec, raw, resolvedPath: null });
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

export const getTypescriptDependenciesUseCase = async (input: {
  root: string;
  logger: FirebatLogger;
}): Promise<{ ok: boolean; dependencies?: Array<{ name: string; version: string; hasTypes: boolean }>; error?: string }> => {
  try {
    const rootAbs = resolveRootAbs(input.root);

    input.logger.debug('lsp:typescriptDependencies', { root: rootAbs });
    const pkgPath = path.resolve(rootAbs, 'package.json');
    const pkgText = await readFile(pkgPath, 'utf8');
    const pkg = JSON.parse(pkgText);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
    const names = Object.keys(deps).sort((a, b) => a.localeCompare(b));
    const withTypes: Array<{ name: string; version: string; hasTypes: boolean }> = [];

    for (const name of names) {
      const depPkgPath = path.resolve(rootAbs, 'node_modules', name, 'package.json');
      const depPkgText = await readWithFallback(depPkgPath);

      if (depPkgText.length === 0) {continue;}

      try {
        const depPkg = JSON.parse(depPkgText);
        const installedVersion = typeof depPkg.version === 'string' ? depPkg.version : deps[name] ?? 'unknown';
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

const externalIndex = new Map<string, Array<{ library: string; symbolName: string; kind: string; filePath: string; line: number }>>();

export const indexExternalLibrariesUseCase = async (input: {
  root: string;
  maxFiles?: number;
  includePatterns?: ReadonlyArray<string>;
  excludePatterns?: ReadonlyArray<string>;
  logger: FirebatLogger;
}): Promise<{ ok: boolean; indexedFiles: number; symbols: number; error?: string }> => {
  try {
    const rootAbs = resolveRootAbs(input.root);
    const maxFiles = input.maxFiles && input.maxFiles > 0 ? Math.min(50_000, Math.floor(input.maxFiles)) : 10_000;

    input.logger.debug('lsp:indexExternalLibraries', { root: rootAbs, maxFiles });
    const include = input.includePatterns && input.includePatterns.length > 0 ? input.includePatterns : ['node_modules/**/*.d.ts'];
    const exclude = new Set(input.excludePatterns ?? ['**/node_modules/**/node_modules/**']);
    const entries: Array<{ library: string; symbolName: string; kind: string; filePath: string; line: number }> = [];
    let seenFiles = 0;

    for (const pattern of include) {
      const glob = new Bun.Glob(pattern);

      for await (const rel of glob.scan({ cwd: rootAbs, onlyFiles: true, followSymlinks: false })) {
        if (seenFiles >= maxFiles) {break;}

        // Best-effort exclude check (string contains based)
        if (Array.from(exclude).some(ex => rel.includes(ex.replaceAll('*', '')))) {
          continue;
        }

        const filePath = path.resolve(rootAbs, rel);
        const text = await readWithFallback(filePath);

        if (text.length === 0) {continue;}

        const parts = rel.split(path.sep);
        const nmIdx = parts.lastIndexOf('node_modules');
        const library = nmIdx >= 0 ? (parts[nmIdx + 1] ?? 'unknown') : 'unknown';
        const lines = splitLines(text);

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? '';
          const m = /\b(export\s+)?(declare\s+)?(class|interface|type|enum|function|const|let|var)\s+([A-Za-z_$][\w$]*)\b/.exec(line);

          if (m?.[4]) {
            entries.push({ library, kind: m[3] ?? 'unknown', symbolName: m[4], filePath, line: i + 1 });
          }
        }

        seenFiles += 1;
      }
      if (seenFiles >= maxFiles) {break;}
    }

    externalIndex.set(rootAbs, entries);

    return { ok: true, indexedFiles: seenFiles, symbols: entries.length };
  } catch (error) {
    return { ok: false, indexedFiles: 0, symbols: 0, error: error instanceof Error ? error.message : String(error) };
  }
};

export const searchExternalLibrarySymbolsUseCase = async (input: {
  root: string;
  libraryName?: string;
  symbolName?: string;
  kind?: string;
  limit?: number;
}): Promise<{ ok: boolean; matches?: any; error?: string }> => {
  try {
    const rootAbs = resolveRootAbs(input.root);
    const entries = externalIndex.get(rootAbs) ?? [];
    const limit = input.limit && input.limit > 0 ? Math.min(500, Math.floor(input.limit)) : 50;
    const lib = (input.libraryName ?? '').toLowerCase();
    const sym = (input.symbolName ?? '').toLowerCase();
    const kind = (input.kind ?? '').toLowerCase();
    const filtered = entries.filter(e => {
      if (lib && !e.library.toLowerCase().includes(lib)) {return false;}

      if (sym && !e.symbolName.toLowerCase().includes(sym)) {return false;}

      if (kind && !e.kind.toLowerCase().includes(kind)) {return false;}

      return true;
    });

    return { ok: true, matches: filtered.slice(0, limit) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};
