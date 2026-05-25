import { parseSync, type ParseResult } from 'oxc-parser';

import type { ParsedFile } from '../types';

/**
 * Optional hook invoked after every successful parse. The test preload sets
 * this to a function that registers the (filePath, sourceText) pair with
 * the gildash semantic layer so subsequent binding queries on the same
 * `filePath` resolve through tsc rather than the legacy ScopeTracker path.
 *
 * Production does not set the hook — production paths are real disk files
 * already indexed by gildash's initial scan, so no register call is needed.
 */
type ParseSourceHook = (filePath: string, sourceText: string) => void;

let _hook: ParseSourceHook | null = null;

export const setParseSourceHook = (hook: ParseSourceHook | null): void => {
  _hook = hook;
};

export const parseSource = (filePath: string, sourceText: string): ParsedFile => {
  const parsed: ParseResult = parseSync(filePath, sourceText);

  if (_hook !== null) {
    _hook(filePath, sourceText);
  }

  return {
    filePath,
    program: parsed.program,
    errors: parsed.errors,
    comments: parsed.comments,
    sourceText,
    module: parsed.module,
  };
};
