import { describe, expect, it } from 'bun:test';

import { analyzeEarlyReturn } from '../../../../../src/features/early-return';
import { createProgramFromMap } from '../../../shared/test-kit';

describe('integration/early-return/imbalanced-if-else', () => {
  it("should report 'invertible-if-else' when branches are imbalanced", () => {
    const sources = new Map<string, string>();

    sources.set(
      '/virtual/early-return/imbalanced.ts',
      [
        'export function process(input: { isValid: boolean }) {',
        '  if (input.isValid) {',
        '    const a = 1;',
        '    const b = 2;',
        '    const c = 3;',
        '    const d = 4;',
        '    const e = 5;',
        '    const f = 6;',
        '    return a + b + c + d + e + f;',
        '  } else {',
        '    return null;',
        '  }',
        '}',
      ].join('\n'),
    );

    const program = createProgramFromMap(sources);
    const analysis = analyzeEarlyReturn(program);
    const item = analysis.find(entry => entry.header === 'process');

    expect(item).toBeDefined();
    expect(item?.kind).toBe('invertible-if-else');
  });

  it("should not report 'invertible-if-else' when branch lengths are similar", () => {
    const sources = new Map<string, string>();

    sources.set(
      '/virtual/early-return/balanced.ts',
      [
        'export function process(input: { isValid: boolean }) {',
        '  if (input.isValid) {',
        '    return 1;',
        '  } else {',
        '    return 0;',
        '  }',
        '}',
      ].join('\n'),
    );

    const program = createProgramFromMap(sources);
    const analysis = analyzeEarlyReturn(program);
    const item = analysis.find(entry => entry.header === 'process');

    expect(item).toBeDefined();
    expect(item?.kind).toBe('missing-guard');
  });
});
