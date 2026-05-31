import type { Gildash } from '@zipbul/gildash';

import { normalizePath } from '@zipbul/gildash';
import * as path from 'node:path';
import ts from 'typescript';

import type { ParsedFile } from '../../engine/types';
import type { FirebatLogger } from '../../shared/logger';
import type { SourceSpan, TypecheckItem } from '../../types';

import { createNoopLogger } from '../../shared/logger';

const createEmptySpan = (): SourceSpan => ({
  start: { line: 1, column: 1 },
  end: { line: 1, column: 1 },
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

interface AnalyzeTypecheckInput {
  readonly rootAbs?: string;
  readonly logger?: FirebatLogger;
  readonly gildash?: Gildash;
}

const shouldIncludeDiagnostic = (category: ts.DiagnosticCategory): boolean => {
  // Only include errors and warnings; skip suggestions and messages
  return category === ts.DiagnosticCategory.Error || category === ts.DiagnosticCategory.Warning;
};

const toSeverity = (_category: ts.DiagnosticCategory): 'error' => {
  // Policy: treat warnings as errors.
  return 'error';
};

const toProjectRelative = (rootAbs: string, filePath: string): string => {
  const rel = path.relative(rootAbs, filePath);
  const normalized = rel.replaceAll('\\', '/');

  return normalized.length > 0 ? normalized : filePath.replaceAll('\\', '/');
};

const findTsconfigPath = (rootAbs: string): string | undefined => {
  const candidate = path.join(rootAbs, 'tsconfig.json');

  try {
    const file = Bun.file(candidate);

    return file.size > 0 ? candidate : undefined;
  } catch {
    return undefined;
  }
};

const attachCodeFrames = (
  program: ReadonlyArray<ParsedFile>,
  items: ReadonlyArray<Omit<TypecheckItem, 'codeFrame'>>,
): ReadonlyArray<TypecheckItem> => {
  const sourceByPath = new Map<string, ReadonlyArray<string>>();

  for (const file of program) {
    sourceByPath.set(normalizePath(file.filePath), buildLineIndex(file.sourceText));
  }

  return items.map(item => {
    if (item.file.length === 0) {
      return { ...item, span: createEmptySpan(), codeFrame: '' };
    }

    const normalized = normalizePath(item.file);
    const lines = sourceByPath.get(normalized);

    if (!lines) {
      return { ...item, codeFrame: '' };
    }

    const frame = buildCodeFrame(lines, item.span.start.line, item.span.start.column);

    return { ...item, codeFrame: frame.codeFrame };
  });
};

const shouldIncludeGildashDiagnostic = (category: 'error' | 'warning' | 'suggestion'): boolean => {
  return category === 'error' || category === 'warning';
};

const analyzeTypecheckViaGildash = (
  program: ReadonlyArray<ParsedFile>,
  root: string,
  gildash: Gildash,
): ReadonlyArray<Omit<TypecheckItem, 'codeFrame'>> => {
  const items: Array<Omit<TypecheckItem, 'codeFrame'>> = [];

  for (const file of program) {
    const diagnostics = gildash.getSemanticDiagnostics(file.filePath, { preEmit: true });

    for (const diag of diagnostics) {
      if (!shouldIncludeGildashDiagnostic(diag.category)) {
        continue;
      }

      const column1Based = diag.column + 1;
      const span: SourceSpan = {
        start: { line: diag.line, column: column1Based },
        end: { line: diag.line, column: column1Based },
      };

      items.push({
        severity: 'error',
        code: `TS${diag.code}`,
        msg: diag.message,
        file: toProjectRelative(root, diag.filePath),
        span,
      });
    }
  }

  return items;
};

const analyzeTypecheck = async (
  program: ReadonlyArray<ParsedFile>,
  input?: AnalyzeTypecheckInput,
): Promise<ReadonlyArray<TypecheckItem>> => {
  const root = input?.rootAbs ?? process.cwd();
  const logger = input?.logger ?? createNoopLogger();
  let itemsWithoutFrames: ReadonlyArray<Omit<TypecheckItem, 'codeFrame'>>;

  if (input?.gildash) {
    logger.debug('typecheck: using gildash getSemanticDiagnostics');

    itemsWithoutFrames = analyzeTypecheckViaGildash(program, root, input.gildash);
  } else {
    const tsconfigPath = findTsconfigPath(root);

    if (!tsconfigPath) {
      throw new Error('typecheck: tsconfig.json not found');
    }

    logger.debug('typecheck: creating ts.Program', { tsconfigPath });

    const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);

    if (configFile.error) {
      const msg = ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n');

      throw new Error(`typecheck: failed to read tsconfig — ${msg}`);
    }

    const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(tsconfigPath));
    const fileNames = program.map(f => f.filePath);
    const tsProgram = ts.createProgram(fileNames, parsedConfig.options);
    const mutableItems: Array<Omit<TypecheckItem, 'codeFrame'>> = [];

    for (const file of program) {
      const sourceFile = tsProgram.getSourceFile(file.filePath);

      if (!sourceFile) {
        continue;
      }

      const diagnostics = ts.getPreEmitDiagnostics(tsProgram, sourceFile);

      for (const diag of diagnostics) {
        if (!shouldIncludeDiagnostic(diag.category)) {
          continue;
        }

        const filePath = diag.file?.fileName ?? file.filePath;
        let span: SourceSpan;

        if (diag.file && diag.start !== undefined) {
          const startLc = diag.file.getLineAndCharacterOfPosition(diag.start);
          const endLc = diag.file.getLineAndCharacterOfPosition(diag.start + (diag.length ?? 0));

          span = {
            start: { line: startLc.line + 1, column: startLc.character + 1 },
            end: { line: endLc.line + 1, column: endLc.character + 1 },
          };
        } else {
          span = createEmptySpan();
        }

        mutableItems.push({
          severity: toSeverity(diag.category),
          code: `TS${diag.code}`,
          msg: ts.flattenDiagnosticMessageText(diag.messageText, '\n').trim(),
          file: toProjectRelative(root, filePath),
          span,
        });
      }
    }

    itemsWithoutFrames = mutableItems;
  }

  const itemsWithFrames = attachCodeFrames(program, itemsWithoutFrames);

  return [...itemsWithFrames].sort((left, right) => {
    if (left.file !== right.file) {
      return left.file.localeCompare(right.file);
    }

    if (left.span.start.line !== right.span.start.line) {
      return left.span.start.line - right.span.start.line;
    }

    return left.span.start.column - right.span.start.column;
  });
};

export { analyzeTypecheck, createEmptyTypecheck };
