import { describe, expect, it } from 'bun:test';

import { analyzeEarlyReturn } from '../../../../../src/test-api';
import { createProgramFromMap } from '../../../shared/test-kit';

describe('integration/early-return/loop-guard-clause', () => {
  it('should detect wrapping-if inside loop body with continue exit', () => {
    const sources = new Map<string, string>();

    sources.set(
      '/virtual/early-return/loop.ts',
      [
        'export function process(items: Array<{ skip: boolean; value: number }>) {',
        '  let total = 0;',
        '  for (const item of items) {',
        '    if (!item.skip) {',
        '      total += item.value;',
        '      total += 1;',
        '      total += 2;',
        '      total += 3;',
        '      total += 4;',
        '    }',
        '  }',
        '  return total;',
        '}',
      ].join('\n'),
    );

    const program = createProgramFromMap(sources);
    const analysis = analyzeEarlyReturn(program);
    const item = analysis.find(entry => entry.header === 'process');

    expect(item).toBeDefined();
    expect(item?.kind).toBe('wrapping-if');
    expect(item?.metrics.statementsAffected).toBe(5);
  });
});
