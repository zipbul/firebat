import type { Fix, Fixer, NodeOrNull, SourceCode } from '../types';

/**
 * True when the source text between `prev` and `next` contains at least one
 * fully blank line (a line that is empty after trimming). Shared by the
 * blank-line layout rules that decide whether statements are already separated.
 */
const hasBlankLineBetween = (sourceCode: SourceCode, prev: NodeOrNull, next: NodeOrNull): boolean => {
  const prevEnd = prev?.range?.[1];
  const nextStart = next?.range?.[0];

  if (typeof prevEnd !== 'number' || typeof nextStart !== 'number') {
    return false;
  }

  const betweenText = sourceCode.text.slice(prevEnd, nextStart);
  const lines = betweenText.split(/\r?\n/);

  if (lines.length < 3) {
    return false;
  }

  return lines.slice(1, -1).some(line => line.trim() === '');
};

/**
 * Builds the fix that inserts one blank line between `prev` and `next` by
 * duplicating the first line-break sequence (preserving CRLF vs LF). Returns
 * `null` when ranges are missing or there is no line break to duplicate.
 */
const insertBlankLine = (sourceCode: SourceCode, prev: NodeOrNull, next: NodeOrNull, fixer: Fixer): Fix | null => {
  const prevEnd = prev?.range?.[1];
  const nextStart = next?.range?.[0];

  if (typeof prevEnd !== 'number' || typeof nextStart !== 'number') {
    return null;
  }

  const betweenText = sourceCode.text.slice(prevEnd, nextStart);

  if (!betweenText.includes('\n')) {
    return null;
  }

  // Preserve CRLF vs LF by duplicating the first line break sequence.
  const fixed = betweenText.replace(/(\r?\n)/, '$1$1');

  return fixer.replaceTextRange([prevEnd, nextStart], fixed);
};

/**
 * The `ReportDescriptor.fix` callback that inserts one blank line between `prev`
 * and `next`. Shared by the blank-line layout rules so the fix wiring has a
 * single expression instead of an identical inline `fix(fixer)` in each rule.
 */
const blankLineFix =
  (sourceCode: SourceCode, prev: NodeOrNull, next: NodeOrNull) =>
  (fixer: Fixer): Fix | null =>
    insertBlankLine(sourceCode, prev, next, fixer);

export { blankLineFix, hasBlankLineBetween };
