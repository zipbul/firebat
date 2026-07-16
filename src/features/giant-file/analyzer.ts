import type { ParsedFile } from '../../engine/types';
import type { GiantFileFinding } from '../../types';

import { normalizeFile } from '../../engine/ast';

/** Documented default line budget applied when the consumer declares no `maxLines` (or `true`/`{}`). */
const DEFAULT_MAX_LINES = 1000;

const createEmptyGiantFile = (): ReadonlyArray<GiantFileFinding> => [];

interface AnalyzeGiantFileOptions {
  readonly maxLines: number;
}

// ECMAScript line-terminator sequences: CRLF (matched first, counted once as a
// single terminator), lone LF, lone CR, U+2028 (line separator), U+2029
// (paragraph separator).
const LINE_TERMINATOR = /\r\n|[\n\r\u2028\u2029]/g;
const ENDS_WITH_TERMINATOR = /(?:\r\n|[\n\r\u2028\u2029])$/;

/** Count ECMAScript line-terminator sequences + 1 iff the text does not end in one; empty text = 0. */
const countLines = (sourceText: string): number => {
  if (sourceText.length === 0) {
    return 0;
  }

  const terminators = sourceText.match(LINE_TERMINATOR)?.length ?? 0;
  const endsInTerminator = ENDS_WITH_TERMINATOR.test(sourceText);

  return terminators + (endsInTerminator ? 0 : 1);
};

const analyzeGiantFile = (
  files: ReadonlyArray<ParsedFile>,
  options: AnalyzeGiantFileOptions,
): ReadonlyArray<GiantFileFinding> => {
  if (files.length === 0) {
    return createEmptyGiantFile();
  }

  const findings: GiantFileFinding[] = [];
  const { maxLines } = options;

  for (const file of files) {
    const lineCount = countLines(file.sourceText);

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

export { analyzeGiantFile, createEmptyGiantFile, DEFAULT_MAX_LINES };
