import type { ParsedFile } from '../../engine/types';
import type { FirebatLogger } from '../../ports/logger';
import type { SourceSpan, TypecheckAnalysis, TypecheckItem } from '../../types';

import { lspUriToFilePath, openTsDocument, withTsgoLspSession } from '../../infrastructure/tsgo/tsgo-runner';
import { createNoopLogger } from '../../ports/logger';

const normalizePath = (value: string): string => value.replaceAll('\\', '/');

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

interface LspPosition {
  readonly line: number;
  readonly character: number;
}

interface LspRange {
  readonly start: LspPosition;
  readonly end: LspPosition;
}

interface LspDiagnostic {
  readonly range: LspRange;
  readonly severity?: number;
  readonly code?: string | number;
  readonly message: string;
  readonly source?: string;
}

interface PublishDiagnosticsParams {
  readonly uri: string;
  readonly diagnostics: ReadonlyArray<LspDiagnostic>;
}

interface LspRangeLike {
  readonly start?: unknown;
  readonly end?: unknown;
}

interface LspPositionLike {
  readonly line?: unknown;
  readonly character?: unknown;
}

interface LspDiagnosticLike {
  readonly range?: unknown;
  readonly message?: unknown;
}

interface PublishDiagnosticsParamsLike {
  readonly uri?: unknown;
  readonly diagnostics?: unknown;
}

interface AnalyzeTypecheckInput {
  readonly rootAbs?: string;
  readonly logger?: FirebatLogger;
}

const toSpanFromRange = (range: LspRange): SourceSpan => {
  return {
    start: { line: range.start.line + 1, column: range.start.character + 1 },
    end: { line: range.end.line + 1, column: range.end.character + 1 },
  };
};

const shouldIncludeDiagnostic = (severity: number | undefined): boolean => {
  // LSP DiagnosticSeverity: 1=Error, 2=Warning, 3=Information, 4=Hint
  // Policy: error-only output; warnings are promoted to error; info/hint are dropped.
  return severity !== 3 && severity !== 4;
};

const toSeverity = (severity: number | undefined): 'error' => {
  // Policy: treat warnings as errors.
  return 'error';
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

  return (params.diagnostics ?? [])
    .filter(diag => shouldIncludeDiagnostic(diag.severity))
    .map(diag => {
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
  input?: AnalyzeTypecheckInput,
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

        const isLspRange = (value: unknown): value is LspRange => {
          if (!value || typeof value !== 'object') {
            return false;
          }

          const shape = value as LspRangeLike;
          const start = shape.start;
          const end = shape.end;

          if (!start || typeof start !== 'object' || !end || typeof end !== 'object') {
            return false;
          }

          const startPosition = start as LspPositionLike;
          const endPosition = end as LspPositionLike;
          const startLine = startPosition.line;
          const startChar = startPosition.character;
          const endLine = endPosition.line;
          const endChar = endPosition.character;

          return (
            typeof startLine === 'number' &&
            typeof startChar === 'number' &&
            typeof endLine === 'number' &&
            typeof endChar === 'number'
          );
        };

        const isLspDiagnostic = (value: unknown): value is LspDiagnostic => {
          if (!value || typeof value !== 'object') {
            return false;
          }

          const shape = value as LspDiagnosticLike;
          const range = shape.range;
          const message = shape.message;

          return typeof message === 'string' && isLspRange(range);
        };

        const isPublishDiagnosticsParams = (value: unknown): value is PublishDiagnosticsParams => {
          if (!value || typeof value !== 'object') {
            return false;
          }

          const shape = value as PublishDiagnosticsParamsLike;
          const uri = shape.uri;
          const diagnostics = shape.diagnostics;

          return typeof uri === 'string' && Array.isArray(diagnostics);
        };

        const dispose = session.lsp.onNotification('textDocument/publishDiagnostics', (raw: unknown) => {
          if (!isPublishDiagnosticsParams(raw)) {
            return;
          }

          const uri = raw.uri;
          const diagnostics = raw.diagnostics.filter(isLspDiagnostic);

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
          let remainingMs = maxWaitMs;
          const expectedUriCount = openUris.length;

          // Wait until diagnostics stop changing (or a max timeout).
          while (remainingMs > 0) {
            if (lastUpdateAt === 0) {
              // No diagnostics yet; wait a short baseline.
              await new Promise<void>(r => setTimeout(r, 25));

              remainingMs = maxWaitMs - (Date.now() - start);

              continue;
            }

            const stableForMs = Date.now() - lastUpdateAt;
            const gotAllUris = expectedUriCount > 0 && seenByUri.size >= expectedUriCount;

            remainingMs = maxWaitMs - (Date.now() - start);

            if (stableForMs >= settleMs && (gotAllUris || maxWaitMs - remainingMs >= 250)) {
              break;
            }

            await new Promise<void>(r => setTimeout(r, 25));

            remainingMs = maxWaitMs - (Date.now() - start);
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
