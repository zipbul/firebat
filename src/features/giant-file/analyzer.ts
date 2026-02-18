import type { ParsedFile } from '../../engine/types';
import type { GiantFileFinding } from '../../types';

import { getLineColumn } from '../../engine/source-position';

const createEmptyGiantFile = (): ReadonlyArray<GiantFileFinding> => [];

const normalizeFile = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/');
  const idx = normalized.lastIndexOf('/src/');

  if (idx >= 0) {
    return normalized.slice(idx + 1);
  }

  return normalized;
};

const spanForWholeFile = (sourceText: string) => {
  const start = getLineColumn(sourceText, 0);
  const end = getLineColumn(sourceText, Math.max(0, sourceText.length));

  return { start, end };
};

interface AnalyzeGiantFileOptions {
  readonly maxLines: number;
}

const analyzeGiantFile = (
  files: ReadonlyArray<ParsedFile>,
  options: AnalyzeGiantFileOptions,
): ReadonlyArray<GiantFileFinding> => {
  if (files.length === 0) {
    return createEmptyGiantFile();
  }

  const findings: GiantFileFinding[] = [];
  const maxLines = Math.max(0, Math.floor(options.maxLines));

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const lineCount = file.sourceText.length === 0 ? 0 : file.sourceText.split(/\r?\n/).length;

    if (lineCount <= maxLines) {
      continue;
    }

    const rel = normalizeFile(file.filePath);
    const code = file.sourceText.slice(0, 200);

    findings.push({
      kind: 'giant-file',
      file: rel,
      span: spanForWholeFile(file.sourceText),
      code,
      metrics: {
        lineCount,
        maxLines,
      },
    });
  }

  return findings;
};

export { analyzeGiantFile, createEmptyGiantFile };
