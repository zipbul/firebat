import { describe, expect, it } from 'bun:test';

import { analyzeNesting } from '../../../../src/features/nesting';
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

function createSwitchSource(): string {
  return [
    'export function decision(value) {',
    '  switch (value) {',
    '    case 1:',
    '      return 1;',
    '    default:',
    '      return 0;',
    '  }',
    '}',
  ].join('\n');
}

function createNestedFunctionSource(): string {
  return [
    'export function outer() {',
    '  function inner(value) {',
    '    if (value) {',
    '      return 1;',
    '    }',
    '    return 0;',
    '  }',
    '  return inner(1);',
    '}',
  ].join('\n');
}

describe('integration/nesting', () => {
  it('should report nesting depth when control flow is complex', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/nesting/complex.ts', createComplexSource());

    // Act
    let program = createProgramFromMap(sources);
    let nesting = analyzeNesting(program);
    let nestingItem = nesting.find(entry => entry.header === 'complex');

    // Assert
    expect(nestingItem).toBeDefined();
    expect(nestingItem?.metrics.depth).toBeGreaterThanOrEqual(2);
  });

  it('should exclude straight-line functions when no suggestions exist', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/nesting/simple.ts', createSimpleSource());

    // Act
    let program = createProgramFromMap(sources);
    let nesting = analyzeNesting(program);
    let nestingItem = nesting.find(entry => entry.header === 'simple');

    // Assert
    expect(nestingItem).toBeUndefined();
  });

  it('should return no findings when input is empty', () => {
    // Arrange
    let sources = new Map<string, string>();
    // Act
    let program = createProgramFromMap(sources);
    let nesting = analyzeNesting(program);

    // Assert
    expect(nesting.length).toBe(0);
  });

  it('should exclude low-complexity switch functions when no suggestions exist', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/nesting/switch.ts', createSwitchSource());

    // Act
    let program = createProgramFromMap(sources);
    let nesting = analyzeNesting(program);
    let item = nesting.find(entry => entry.header === 'decision');

    // Assert
    expect(item).toBeUndefined();
  });

  it('should exclude outer functions when no suggestions exist', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/nesting/nested.ts', createNestedFunctionSource());

    // Act
    let program = createProgramFromMap(sources);
    let nesting = analyzeNesting(program);
    let item = nesting.find(entry => entry.header === 'outer');

    // Assert
    expect(item).toBeUndefined();
  });

  it('should compute cognitive complexity using nesting bonus', () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/nesting/cognitive.ts';
    let source = [
      'export function c(a, b, c) {',
      '  if (a) {',
      '    if (b) {',
      '      if (c) {',
      '        return 1;',
      '      }',
      '    }',
      '  }',
      '  return 0;',
      '}',
    ].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let nesting = analyzeNesting(program);
    let item = nesting.find(entry => entry.header === 'c');

    // Assert
    expect(item).toBeDefined();
    expect(item?.metrics.cognitiveComplexity).toBe(6);
  });

  it('should detect accidental quadratic nested iteration over the same collection', () => {
    // Arrange
    let sources = new Map<string, string>();
    let filePath = '/virtual/nesting/quadratic.ts';
    let source = [
      'export function q(users) {',
      '  users.forEach(u => {',
      '    users.find(other => other.id === u.managerId);',
      '  });',
      '}',
    ].join('\n');

    sources.set(filePath, source);

    // Act
    let program = createProgramFromMap(sources);
    let nesting = analyzeNesting(program);
    let item = nesting.find(entry => entry.header === 'q');

    // Assert
    expect(item).toBeDefined();
    expect(item?.kind).toBe('accidental-quadratic');
    expect(item?.metrics.quadraticTargets).toContain('users');
  });
});
