import { describe, expect, it } from 'bun:test';

import { detectWaste } from '../../../../../src/test-api';
import { createProgramFromMap } from '../../../shared/test-kit';

describe('integration/waste/closure-capture', () => {
  it('should not report dead-store when variable is read inside a nested function closure', () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set(
      '/virtual/waste/closure-capture.ts',
      ['export function setup() {', '  let count = 0;', '  const increment = () => count++;', '  return increment;', '}'].join(
        '\n',
      ),
    );

    // Act
    const program = createProgramFromMap(sources);
    const findings = detectWaste(program);
    // Assert
    const countFindings = findings.filter(f => f.label === 'count');

    expect(countFindings.length).toBe(0);
  });
});
