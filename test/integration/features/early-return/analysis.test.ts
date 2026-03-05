import { describe, expect, it } from 'bun:test';

import { analyzeEarlyReturn } from '../../../../src/test-api';
import { createProgramFromMap } from '../../shared/test-kit';

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

describe('integration/early-return', () => {
  it('should not report complex function when no actionable pattern exists', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/early-return/complex.ts', createComplexSource());

    // Act
    let program = createProgramFromMap(sources);
    let earlyReturn = analyzeEarlyReturn(program);
    let item = earlyReturn.find(entry => entry.header === 'complex');

    // Assert — guard clause (1-stmt), mid-body if (not last), loop 1-stmt if → no actionable pattern
    expect(item).toBeUndefined();
  });

  it('should not include simple functions without patterns', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/early-return/simple.ts', createSimpleSource());

    // Act
    let program = createProgramFromMap(sources);
    let earlyReturn = analyzeEarlyReturn(program);
    let item = earlyReturn.find(entry => entry.header === 'simple');

    // Assert — simple function has no opportunities, no finding
    expect(item).toBeUndefined();
  });

  it('should not report balanced if-else as invertible', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/early-return/else.ts', createIfElseSource());

    // Act
    let program = createProgramFromMap(sources);
    let earlyReturn = analyzeEarlyReturn(program);
    let item = earlyReturn.find(entry => entry.header === 'hasElse');

    // Assert — balanced 1:1 if-else doesn't meet 2x ratio threshold
    expect(item).toBeUndefined();
  });

  it('should return no findings when input is empty', () => {
    // Arrange
    let sources = new Map<string, string>();
    // Act
    let program = createProgramFromMap(sources);
    let earlyReturn = analyzeEarlyReturn(program);

    // Assert
    expect(earlyReturn.length).toBe(0);
  });

  it('should not report try-catch function without actionable patterns', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/early-return/try.ts', createTryCatchSource());

    // Act
    let program = createProgramFromMap(sources);
    let earlyReturn = analyzeEarlyReturn(program);
    let item = earlyReturn.find(entry => entry.header === 'guarded');

    // Assert — no wrapping-if/invertible/cascade patterns → no finding
    expect(item).toBeUndefined();
  });
});
