import { describe, expect, it } from 'bun:test';

import { analyzeNesting } from '../../../../src/test-api';
import { analyzeSource } from '../../shared/test-kit';

const complexSource = [
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

interface ExcludedCase {
  readonly title: string;
  readonly header: string;
  readonly source: string;
}

const excludedCases: ExcludedCase[] = [
  {
    title: 'straight-line functions',
    header: 'simple',
    source: ['export function simple(value) {', '  const nextValue = value + 1;', '  return nextValue;', '}'].join('\n'),
  },
  {
    title: 'low-complexity switch functions',
    header: 'decision',
    source: [
      'export function decision(value) {',
      '  switch (value) {',
      '    case 1:',
      '      return 1;',
      '    default:',
      '      return 0;',
      '  }',
      '}',
    ].join('\n'),
  },
  {
    title: 'outer functions',
    header: 'outer',
    source: [
      'export function outer() {',
      '  function inner(value) {',
      '    if (value) {',
      '      return 1;',
      '    }',
      '    return 0;',
      '  }',
      '  return inner(1);',
      '}',
    ].join('\n'),
  },
];

describe('integration/nesting', () => {
  it('should report nesting depth when control flow is complex', () => {
    // Act
    const nesting = analyzeSource(complexSource, analyzeNesting);
    const nestingItem = nesting.find(entry => entry.header === 'complex');

    // Assert
    expect(nestingItem).toBeDefined();
    expect(nestingItem?.metrics.depth).toBeGreaterThanOrEqual(2);
  });

  it.each(excludedCases)('should exclude $title when no suggestions exist', ({ header, source }) => {
    // Act
    const nesting = analyzeSource(source, analyzeNesting);
    const item = nesting.find(entry => entry.header === header);

    // Assert
    expect(item).toBeUndefined();
  });

  it('should return no findings when input is empty', () => {
    // Act
    const nesting = analyzeNesting([]);

    // Assert
    expect(nesting.length).toBe(0);
  });

  it('should compute cognitive complexity using nesting bonus', () => {
    // Arrange
    const source = [
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
    // Act
    const nesting = analyzeSource(source, analyzeNesting);
    const item = nesting.find(entry => entry.header === 'c');

    // Assert
    expect(item).toBeDefined();
    expect(item?.metrics.cognitiveComplexity).toBe(6);
  });

  it('should detect accidental quadratic nested iteration over the same collection', () => {
    // Arrange
    const source = [
      'export function q(users) {',
      '  users.forEach(u => {',
      '    users.find(other => other.id === u.managerId);',
      '  });',
      '}',
    ].join('\n');
    // Act
    const nesting = analyzeSource(source, analyzeNesting);
    const item = nesting.find(entry => entry.header === 'q');

    // Assert
    expect(item).toBeDefined();
    expect(item?.kind).toBe('accidental-quadratic');
    expect(item?.metrics.quadraticTargets).toContain('users');
  });
});
