import { describe, expect, it } from 'bun:test';

import { findItemByHeader } from '../../../shared/early-return-cases';

describe('integration/early-return/throw-guard', () => {
  it('should not report function with only guard clauses and no actionable patterns', () => {
    // Arrange
    const source = [
      'export function guarded(input: string | null) {',
      '  if (!input) {',
      '    throw new Error("missing");',
      '  }',
      '  if (input === "a") return 1;',
      '  if (input === "b") return 2;',
      '  if (input === "c") return 3;',
      '  return 4;',
      '}',
    ].join('\n');

    // Act
    const item = findItemByHeader(source, 'guarded');

    // Assert — no wrapping-if, invertible-if-else, or cascade-guard patterns → no finding
    expect(item).toBeUndefined();
  });
});
