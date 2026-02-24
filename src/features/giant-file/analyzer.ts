import type { ParsedFile } from '../../engine/types';
import type { GiantFileFinding } from '../../types';

import { normalizeFile } from '../../engine/ast/normalize-file';

const createEmptyGiantFile = (): ReadonlyArray<GiantFileFinding> => [];

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

    findings.push({
      kind: 'giant-file',
      file: rel,
      span: { start: { line: 1, column: 0 }, end: { line: lineCount, column: 0 } },
      metrics: {
        lineCount,
        maxLines,
      },
    });
  }

  return findings;
};

export { analyzeGiantFile, createEmptyGiantFile };
