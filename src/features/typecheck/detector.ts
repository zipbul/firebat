import * as path from 'node:path';

import type { ParsedFile } from '../../engine/types';
import type { FirebatLogger } from '../../ports/logger';
import type { SourceSpan, TypecheckAnalysis, TypecheckItem } from '../../types';

import { lspUriToFilePath, openTsDocument, withTsgoLspSession } from '../../infrastructure/tsgo/tsgo-runner';
import { createNoopLogger } from '../../ports/logger';

const normalizePath = (value: string): string => value.replaceAll('\\', '/');

const toAbsolutePath = (cwd: string, raw: string): string => {
  const normalized = normalizePath(raw);

  if (path.isAbsolute(normalized)) {
    return normalized;
  }

  return normalizePath(path.resolve(cwd, normalized));
};

const createEmptySpan = (): SourceSpan => ({
  start: {
    line: 1,
    column: 1,
  },
  end: {
    line: 1,
    column: 1,
  },
});

const createEmptyTypecheck = (): TypecheckAnalysis => ({
  status: 'ok',
  tool: 'tsgo',
  exitCode: 0,
  items: [],
});

const buildLineIndex = (sourceText: string): ReadonlyArray<string> => {
  return sourceText.split(/\r?\n/);
};

const buildCodeFrame = (
  lines: ReadonlyArray<string>,
  line: number,
  column: number,
): Pick<TypecheckItem, 'lineText' | 'codeFrame'> => {
  const picked = lines[line - 1] ?? '';
  const safeColumn = Math.max(1, column);
  const caretPrefix = ' '.repeat(Math.max(0, safeColumn - 1));
  const caretLine = `${caretPrefix}^`;

  return {
    lineText: picked,
    codeFrame: picked.length > 0 ? `${picked}\n${caretLine}` : '',
  };
};

type LspPosition = { readonly line: number; readonly character: number };

type LspRange = { readonly start: LspPosition; readonly end: LspPosition };

type LspDiagnostic = {
  readonly range: LspRange;
  readonly severity?: number;
  readonly code?: string | number;
  readonly message: string;
  readonly source?: string;
};

type PublishDiagnosticsParams = {
  readonly uri: string;
  readonly diagnostics: ReadonlyArray<LspDiagnostic>;
};

const toSpanFromRange = (range: LspRange): SourceSpan => {
  return {
    start: { line: range.start.line + 1, column: range.start.character + 1 },
    end: { line: range.end.line + 1, column: range.end.character + 1 },
  };
};

const toSeverity = (severity: number | undefined): 'error' | 'warning' => {
  // LSP DiagnosticSeverity: 1=Error, 2=Warning, 3=Information, 4=Hint
  return severity === 2 ? 'warning' : 'error';
};

const toCodeText = (code: string | number | undefined, source: string | undefined): string => {
  if (typeof code === 'string' && code.length > 0) {
    return code;
  }

  if (typeof code === 'number' && Number.isFinite(code)) {
    return String(code);
  }

  if (typeof source === 'string' && source.length > 0) {
    return source;
  }

  return 'TS';
};

const convertPublishDiagnosticsToTypecheckItems = (
  params: PublishDiagnosticsParams,
): ReadonlyArray<Omit<TypecheckItem, 'lineText' | 'codeFrame'>> => {
  const filePath = lspUriToFilePath(params.uri);

  return (params.diagnostics ?? []).map(diag => {
    return {
      severity: toSeverity(diag.severity),
      code: toCodeText(diag.code, diag.source),
      message: typeof diag.message === 'string' ? diag.message.trim() : String(diag.message),
      filePath,
      span: toSpanFromRange(diag.range),
    };
  });
};

const attachCodeFrames = (
  program: ReadonlyArray<ParsedFile>,
  items: ReadonlyArray<Omit<TypecheckItem, 'lineText' | 'codeFrame'>>,
): ReadonlyArray<TypecheckItem> => {
  const sourceByPath = new Map<string, ReadonlyArray<string>>();

  for (const file of program) {
    sourceByPath.set(normalizePath(file.filePath), buildLineIndex(file.sourceText));
  }

  return items.map(item => {
    if (item.filePath.length === 0) {
      return {
        ...item,
        span: createEmptySpan(),
        lineText: '',
        codeFrame: '',
      };
    }

    const normalized = normalizePath(item.filePath);
    const lines = sourceByPath.get(normalized);

    if (!lines) {
      return {
        ...item,
        lineText: '',
        codeFrame: '',
      };
    }

    const frame = buildCodeFrame(lines, item.span.start.line, item.span.start.column);

    return {
      ...item,
      lineText: frame.lineText,
      codeFrame: frame.codeFrame,
    };
  });
};

const analyzeTypecheck = async (
  program: ReadonlyArray<ParsedFile>,
  input?: {
    readonly rootAbs?: string;
    readonly logger?: FirebatLogger;
  },
): Promise<TypecheckAnalysis> => {
  const root = input?.rootAbs ?? process.cwd();
  const logger = input?.logger ?? createNoopLogger();

  try {
    const result = await withTsgoLspSession<ReadonlyArray<Omit<TypecheckItem, 'lineText' | 'codeFrame'>>>(
      { root, logger },
      async session => {
        const collected: Array<Omit<TypecheckItem, 'lineText' | 'codeFrame'>> = [];
        const openUris: string[] = [];
        const seenByUri = new Map<string, ReadonlyArray<LspDiagnostic>>();
        let lastUpdateAt = 0;
        const dispose = session.lsp.onNotification('textDocument/publishDiagnostics', (raw: any) => {
          if (!raw || typeof raw !== 'object') {
            return;
          }

          const uri = typeof raw.uri === 'string' ? raw.uri : '';
          const diagnostics = Array.isArray(raw.diagnostics) ? (raw.diagnostics as ReadonlyArray<LspDiagnostic>) : [];

          if (uri.length === 0) {
            return;
          }

          lastUpdateAt = Date.now();

          seenByUri.set(uri, diagnostics);
        });

        try {
          // Open all program files so tsgo can compute diagnostics.
          for (const file of program) {
            const opened = await openTsDocument({ lsp: session.lsp, filePath: file.filePath, text: file.sourceText });

            openUris.push(opened.uri);
          }

          const settleMs = 200;
          const maxWaitMs = Math.min(10_000, Math.max(500, program.length * 3));
          const start = Date.now();
          const expectedUriCount = openUris.length;

          // Wait until diagnostics stop changing (or a max timeout).
          while (Date.now() - start < maxWaitMs) {
            if (lastUpdateAt === 0) {
              // No diagnostics yet; wait a short baseline.
              await new Promise<void>(r => setTimeout(r, 25));

              continue;
            }

            const stableForMs = Date.now() - lastUpdateAt;
            const gotAllUris = expectedUriCount > 0 && seenByUri.size >= expectedUriCount;

            if (stableForMs >= settleMs && (gotAllUris || Date.now() - start >= 250)) {
              break;
            }

            await new Promise<void>(r => setTimeout(r, 25));
          }

          for (const [uri, diagnostics] of seenByUri) {
            collected.push(
              ...convertPublishDiagnosticsToTypecheckItems({
                uri,
                diagnostics,
              }),
            );
          }

          return collected;
        } finally {
          dispose();
          await Promise.all(
            openUris.map(uri => session.lsp.notify('textDocument/didClose', { textDocument: { uri } }).catch(() => undefined)),
          );
        }
      },
    );

    if (!result.ok) {
      return {
        status: 'unavailable',
        tool: 'tsgo',
        exitCode: null,
        items: [],
      };
    }

    const itemsWithFrames = attachCodeFrames(program, result.value);
    const items = [...itemsWithFrames].sort((left: TypecheckItem, right: TypecheckItem) => {
      if (left.filePath !== right.filePath) {
        return left.filePath.localeCompare(right.filePath);
      }

      if (left.span.start.line !== right.span.start.line) {
        return left.span.start.line - right.span.start.line;
      }

      return left.span.start.column - right.span.start.column;
    });

    return {
      status: 'ok',
      tool: 'tsgo',
      exitCode: 0,
      items,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    return {
      status: 'failed',
      tool: 'tsgo',
      exitCode: null,
      error: errorMessage,
      items: [],
    };
  }
};

export { analyzeTypecheck, createEmptyTypecheck, convertPublishDiagnosticsToTypecheckItems };
