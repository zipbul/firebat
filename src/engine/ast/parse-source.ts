import { parseSync, type ParseResult } from 'oxc-parser';

import type { ParsedFile } from '../types';

export const parseSource = (filePath: string, sourceText: string): ParsedFile => {
  const parsed: ParseResult = parseSync(filePath, sourceText);

  return {
    filePath,
    program: parsed.program,
    errors: parsed.errors,
    comments: parsed.comments,
    sourceText,
  };
};
