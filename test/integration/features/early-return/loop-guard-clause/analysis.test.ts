import { describe, expect, it } from 'bun:test';

import { findDefinedItem } from '../../../shared/early-return-cases';

describe('integration/early-return/loop-guard-clause', () => {
  it('should detect wrapping-if inside loop body with continue exit', () => {
    // Arrange
    const source = [
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
    ].join('\n');
    // Act
    // Assert
    const item = findDefinedItem(source, 'process');
    expect(item?.kind).toBe('wrapping-if');
    expect(item?.metrics.statementsAffected).toBe(5);
  });
});
