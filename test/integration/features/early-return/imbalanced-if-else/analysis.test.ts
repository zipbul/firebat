import { describe, expect, it } from 'bun:test';

import { findDefinedItem, findItemByHeader } from '../../../shared/early-return-cases';

describe('integration/early-return/imbalanced-if-else', () => {
  it("should report 'invertible-if-else' when branches are imbalanced", () => {
    // Arrange
    const source = [
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
    ].join('\n');
    // Act
    // Assert
    const item = findDefinedItem(source, 'process');
    expect(item?.kind).toBe('invertible-if-else');
  });

  it('should not report invertible when branch lengths are similar (balanced)', () => {
    // Arrange
    const source = [
      'export function process(input: { isValid: boolean }) {',
      '  if (input.isValid) {',
      '    return 1;',
      '  } else {',
      '    return 0;',
      '  }',
      '}',
    ].join('\n');
    // Act
    const item = findItemByHeader(source, 'process');

    // Assert — balanced 1:1 branches don't meet the ratio threshold → no finding
    expect(item).toBeUndefined();
  });
});
