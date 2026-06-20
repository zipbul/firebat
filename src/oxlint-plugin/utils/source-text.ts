import type { SourceCode } from '../types';

/**
 * Reads the full source text, preferring the ESLint-style `getText()` accessor
 * when present and falling back to the raw `text` property otherwise. Shared by
 * the fixer rules that need the original text to compute safe edit ranges.
 */
const getSourceText = (sourceCode: SourceCode): string =>
  typeof sourceCode.getText === 'function' ? sourceCode.getText() : sourceCode.text;

export { getSourceText };
