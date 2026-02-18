import * as path from 'node:path';

import type { ParsedFile } from '../../engine/types';
import type { FirebatLogger } from '../../ports/logger';
import type { SourceSpan, TypecheckItem } from '../../types';

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

const createEmptyTypecheck = (): ReadonlyArray<TypecheckItem> => [];

const buildLineIndex = (sourceText: string): ReadonlyArray<string> => {
  return sourceText.split(/\r?\n/);
};

const buildCodeFrame = (lines: ReadonlyArray<string>, line: number, column: number): Pick<TypecheckItem, 'codeFrame'> => {
  const picked = lines[line - 1] ?? '';
  const safeColumn = Math.max(1, column);
  const caretPrefix = ' '.repeat(Math.max(0, safeColumn - 1));
  const caretLine = `${caretPrefix}^`;

  return {
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

interface PullDiagnosticsFullReport {
  readonly kind: 'full';
  readonly items?: ReadonlyArray<LspDiagnostic>;
}

interface PullDiagnosticsUnchangedReport {
  readonly kind: 'unchanged';
  readonly resultId?: string;
}

type PullDiagnosticsReport = PullDiagnosticsFullReport | PullDiagnosticsUnchangedReport;

interface PullDiagnosticsFullReportLike {
  readonly kind?: unknown;
  readonly items?: unknown;
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

const isPullDiagnosticsFullReport = (value: unknown): value is PullDiagnosticsFullReport => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const shape = value as PullDiagnosticsFullReportLike;

  return shape.kind === 'full' && (shape.items === undefined || Array.isArray(shape.items));
};

const pullDiagnosticsToItems = (raw: unknown): ReadonlyArray<LspDiagnostic> => {
  if (Array.isArray(raw)) {
    return raw as ReadonlyArray<LspDiagnostic>;
  }

  if (isPullDiagnosticsFullReport(raw)) {
    return (raw.items ?? []) as ReadonlyArray<LspDiagnostic>;
  }

  // Some servers return `{ items: [...] }` without `kind`.
  if (raw && typeof raw === 'object') {
    const items = (raw as { items?: unknown }).items;

    if (Array.isArray(items)) {
      return items as ReadonlyArray<LspDiagnostic>;
    }
  }

  return [];
};

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

type TypecheckItemWithoutFrame = Omit<TypecheckItem, 'codeFrame'>;

const convertPublishDiagnosticsToTypecheckItems = (
  params: PublishDiagnosticsParams,
): ReadonlyArray<TypecheckItemWithoutFrame> => {
  const file = lspUriToFilePath(params.uri);

  return (params.diagnostics ?? [])
    .filter(diag => shouldIncludeDiagnostic(diag.severity))
    .map(diag => {
      return {
        severity: toSeverity(diag.severity),
        code: toCodeText(diag.code, diag.source),
        msg: typeof diag.message === 'string' ? diag.message.trim() : String(diag.message),
        file,
        span: toSpanFromRange(diag.range),
      };
    });
};

const attachCodeFrames = (
  program: ReadonlyArray<ParsedFile>,
  items: ReadonlyArray<TypecheckItemWithoutFrame>,
): ReadonlyArray<TypecheckItem> => {
  const sourceByPath = new Map<string, ReadonlyArray<string>>();

  for (const file of program) {
    sourceByPath.set(normalizePath(file.filePath), buildLineIndex(file.sourceText));
  }

  return items.map(item => {
    if (item.file.length === 0) {
      return {
        ...item,
        span: createEmptySpan(),
        codeFrame: '',
      };
    }

    const normalized = normalizePath(item.file);
    const lines = sourceByPath.get(normalized);

    if (!lines) {
      return {
        ...item,
        codeFrame: '',
      };
    }

    const frame = buildCodeFrame(lines, item.span.start.line, item.span.start.column);

    return {
      ...item,
      codeFrame: frame.codeFrame,
    };
  });
};

const toProjectRelative = (rootAbs: string, filePath: string): string => {
  const rel = path.relative(rootAbs, filePath);
  const normalized = rel.replaceAll('\\', '/');

  return normalized.length > 0 ? normalized : filePath.replaceAll('\\', '/');
};

const analyzeTypecheck = async (
  program: ReadonlyArray<ParsedFile>,
  input?: AnalyzeTypecheckInput,
): Promise<ReadonlyArray<TypecheckItem>> => {
  const root = input?.rootAbs ?? process.cwd();
  const logger = input?.logger ?? createNoopLogger();

  try {
    const result = await withTsgoLspSession<ReadonlyArray<TypecheckItemWithoutFrame>>({ root, logger }, async session => {
      const collected: Array<TypecheckItemWithoutFrame> = [];
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

      const requestDocumentDiagnosticsOnce = async (uri: string) => {
        return session.lsp
          .request('textDocument/diagnostic', { textDocument: { uri }, previousResultId: null }, 10_000)
          .catch(() => null);
      };

      const requestDocumentDiagnostics = async (uri: string) => {
        const first = await requestDocumentDiagnosticsOnce(uri);

        if (first !== null) {
          return first;
        }

        // tsgo can occasionally need a brief warm-up right after didOpen.
        await new Promise<void>(r => setTimeout(r, 30));

        return requestDocumentDiagnosticsOnce(uri);
      };

      try {
        // Open all program files so tsgo can compute diagnostics.
        for (const file of program) {
          const opened = await openTsDocument({ lsp: session.lsp, filePath: file.filePath, text: file.sourceText });

          openUris.push(opened.uri);

          const pulled = await requestDocumentDiagnostics(opened.uri);
          const pulledDiagnostics = pullDiagnosticsToItems(pulled).filter(isLspDiagnostic);

          if (pulledDiagnostics.length > 0) {
            seenByUri.set(opened.uri, pulledDiagnostics);

            lastUpdateAt = Date.now();
          }
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
    });

    if (!result.ok) {
      throw new Error(`tsgo: ${result.error}`);
    }

    const itemsWithFrames = attachCodeFrames(program, result.value);
    const items = itemsWithFrames
      .map(item => ({
        ...item,
        file: item.file.length > 0 ? toProjectRelative(root, item.file) : item.file,
      }))
      .sort((left: TypecheckItem, right: TypecheckItem) => {
        if (left.file !== right.file) {
          return left.file.localeCompare(right.file);
        }

        if (left.span.start.line !== right.span.start.line) {
          return left.span.start.line - right.span.start.line;
        }

        return left.span.start.column - right.span.start.column;
      });

    return items;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    throw new Error(errorMessage.includes('tsgo') ? errorMessage : `tsgo: ${errorMessage}`);
  }
};

export { analyzeTypecheck, createEmptyTypecheck, convertPublishDiagnosticsToTypecheckItems };

export const __test__ = {
  pullDiagnosticsToItems,
};
