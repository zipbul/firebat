import { describe, expect, it } from 'bun:test';

import { analyzeEarlyReturn } from '../../../src/features/early-return';
import { createProgramFromMap } from '../shared/test-kit';

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
  it('should include complex functions with guard clauses', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/early-return/complex.ts', createComplexSource());

    // Act
    let program = createProgramFromMap(sources);
    let earlyReturn = analyzeEarlyReturn(program);
    let item = earlyReturn.find(entry => entry.header === 'complex');

    // Assert
    expect(item).toBeDefined();
    expect(item?.metrics.hasGuards).toBe(true);
    expect(item?.metrics.guards).toBeGreaterThanOrEqual(1);
  });

  it('should include simple functions with early returns', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/early-return/simple.ts', createSimpleSource());

    // Act
    let program = createProgramFromMap(sources);
    let earlyReturn = analyzeEarlyReturn(program);
    let item = earlyReturn.find(entry => entry.header === 'simple');

    // Assert
    expect(item).toBeDefined();
    expect(item?.metrics.returns).toBeGreaterThanOrEqual(1);
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

  it('should include if-else functions and count returns', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/early-return/else.ts', createIfElseSource());

    // Act
    let program = createProgramFromMap(sources);
    let earlyReturn = analyzeEarlyReturn(program);
    let item = earlyReturn.find(entry => entry.header === 'hasElse');

    // Assert
    expect(item).toBeDefined();
    expect(item?.metrics.returns).toBeGreaterThanOrEqual(2);
  });

  it('should count early returns when try/catch flows exist', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/early-return/try.ts', createTryCatchSource());

    // Act
    let program = createProgramFromMap(sources);
    let earlyReturn = analyzeEarlyReturn(program);
    let item = earlyReturn.find(entry => entry.header === 'guarded');

    // Assert
    expect(item).toBeDefined();
    expect(item?.metrics.returns).toBeGreaterThanOrEqual(2);
  });
});
