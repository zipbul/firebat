import { describe, expect, it } from 'bun:test';

import { analyzeEarlyReturn } from '../../../../src/features/early-return';
import { createProgramFromMap } from '../../shared/test-kit';

describe('integration/early-return/throw-guard', () => {
  it('should treat throw as a guard clause (hasGuardClauses=true)', () => {
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

    expect(item).toBeDefined();
    expect(item?.metrics.hasGuards).toBe(true);
    expect(item?.metrics.guards).toBeGreaterThanOrEqual(1);
  });
});
