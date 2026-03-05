import { describe, expect, it } from 'bun:test';

import { analyzeEarlyReturn } from '../../../../../src/test-api';
import { createProgramFromMap } from '../../../shared/test-kit';

describe('integration/early-return/throw-guard', () => {
  it('should not report function with only guard clauses and no actionable patterns', () => {
    const sources = new Map<string, string>();

    sources.set(
      '/virtual/early-return/throw-guard.ts',
      [
        'export function guarded(input: string | null) {',
        '  if (!input) {',
        '    throw new Error("missing");',
        '  }',
        '  if (input === "a") return 1;',
        '  if (input === "b") return 2;',
        '  if (input === "c") return 3;',
        '  return 4;',
        '}',
      ].join('\n'),
    );

    const program = createProgramFromMap(sources);
    const analysis = analyzeEarlyReturn(program);
    const item = analysis.find(entry => entry.header === 'guarded');

    // No wrapping-if, invertible-if-else, or cascade-guard patterns → no finding
    expect(item).toBeUndefined();
  });
});
