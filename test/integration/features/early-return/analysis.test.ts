import { describe, expect, it } from 'bun:test';

import { analyzeEarlyReturn } from '../../../../src/test-api';
import { findItemByHeader } from '../../shared/early-return-cases';
import { analyzeSource } from '../../shared/test-kit';

function createComplexSource(): string {
  return [
    'export function complex(value) {',
    '  if (!value) {',
    '    return 0;',
    '  }',
    '  if (value > 0) {',
    '    for (let index = 0; index < value; index += 1) {',
    '      if (index % 2 === 0) {',
    '        value += 1;',
    '      }',
    '    }',
    '  }',
    '  return value;',
    '}',
  ].join('\n');
}

function createSimpleSource(): string {
  return ['export function simple(value) {', '  const nextValue = value + 1;', '  return nextValue;', '}'].join('\n');
}

function createIfElseSource(): string {
  return [
    'export function hasElse(value) {',
    '  if (value) {',
    '    return 1;',
    '  }',
    '  else {',
    '    return 0;',
    '  }',
    '}',
  ].join('\n');
}

function createTryCatchSource(): string {
  return [
    'export function guarded(value) {',
    '  try {',
    '    if (!value) {',
    '      return 0;',
    '    }',
    '  } catch (err) {',
    '    return -1;',
    '  }',
    '  return 1;',
    '}',
  ].join('\n');
}

interface NoFindingCase {
  title: string;
  source: string;
  header: string;
}

const noFindingCases: NoFindingCase[] = [
  {
    // guard clause (1-stmt), mid-body if (not last), loop 1-stmt if → no actionable pattern
    title: 'should not report complex function when no actionable pattern exists',
    source: createComplexSource(),
    header: 'complex',
  },
  {
    // simple function has no opportunities, no finding
    title: 'should not include simple functions without patterns',
    source: createSimpleSource(),
    header: 'simple',
  },
  {
    // balanced 1:1 if-else doesn't meet 2x ratio threshold
    title: 'should not report balanced if-else as invertible',
    source: createIfElseSource(),
    header: 'hasElse',
  },
  {
    // no wrapping-if/invertible/cascade patterns → no finding
    title: 'should not report try-catch function without actionable patterns',
    source: createTryCatchSource(),
    header: 'guarded',
  },
];

describe('integration/early-return', () => {
  it.each(noFindingCases)('$title', ({ source, header }) => {
    // Act
    const item = findItemByHeader(source, header);

    // Assert
    expect(item).toBeUndefined();
  });

  it('should return no findings when input is empty', () => {
    // Act
    const earlyReturn = analyzeSource('', analyzeEarlyReturn);

    // Assert
    expect(earlyReturn.length).toBe(0);
  });
});
