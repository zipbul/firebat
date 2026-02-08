import { describe, expect, it } from 'bun:test';

import { analyzeNesting } from '../../../src/features/nesting';
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
    let nestingItem = nesting.items.find(entry => entry.header === 'complex');

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
    let nestingItem = nesting.items.find(entry => entry.header === 'simple');

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
    expect(nesting.items.length).toBe(0);
  });

  it('should exclude low-complexity switch functions when no suggestions exist', () => {
    // Arrange
    let sources = new Map<string, string>();

    sources.set('/virtual/nesting/switch.ts', createSwitchSource());

    // Act
    let program = createProgramFromMap(sources);
    let nesting = analyzeNesting(program);
    let item = nesting.items.find(entry => entry.header === 'decision');

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
    let item = nesting.items.find(entry => entry.header === 'outer');

    // Assert
    expect(item).toBeUndefined();
  });
});
