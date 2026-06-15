import { describe, expect, it } from 'bun:test';

import { detectWasteLabelFindings } from '../_shared';

describe('integration/waste/closure-capture', () => {
  it('should not report dead-store when variable is read inside a nested function closure', () => {
    // Arrange
    const source = ['export function setup() {', '  let count = 0;', '  const increment = () => count++;', '  return increment;', '}'].join(
      '\n',
    );

    // Act
    const countFindings = detectWasteLabelFindings('/virtual/waste/closure-capture.ts', source, 'count');

    // Assert
    expect(countFindings.length).toBe(0);
  });
});
