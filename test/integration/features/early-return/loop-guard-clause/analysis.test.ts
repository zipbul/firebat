import { describe, expect, it } from 'bun:test';

import { analyzeEarlyReturn } from '../../../../../src/test-api';
import { createProgramFromMap } from '../../../shared/test-kit';

describe('integration/early-return/loop-guard-clause', () => {
  it('should treat continue/break as loop guard clauses', () => {
    const sources = new Map<string, string>();

    sources.set(
      '/virtual/early-return/loop.ts',
      [
        'export function process(items: Array<{ skip: boolean; value: number }>) {',
        '  let total = 0;',
        '  for (const item of items) {',
        '    if (item.skip) {',
        '      continue;',
        '    }',
        '    total += item.value;',
        '    total += 1;',
        '    total += 2;',
        '    total += 3;',
        '    total += 4;',
        '  }',
        '  return total;',
        '}',
      ].join('\n'),
    );

    const program = createProgramFromMap(sources);
    const analysis = analyzeEarlyReturn(program);
    const item = analysis.find(entry => entry.header === 'process');

    expect(item).toBeDefined();
    expect(item?.metrics.hasGuards).toBe(true);
    expect(item?.metrics.guards).toBeGreaterThanOrEqual(1);
  });
});
