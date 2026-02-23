import { describe, expect, it } from 'bun:test';

import { detectWaste } from '../../../../../src/test-api';
import { createProgramFromMap } from '../../../shared/test-kit';

describe('integration/waste/closure-overwritten', () => {
  it('should still report dead-store for overwritten defs that do not reach the closure', () => {
    // Arrange
    const sources = new Map<string, string>();

    sources.set(
      '/virtual/waste/closure-overwritten.ts',
      ['export function example() {', '  let x = 1;', '  x = 2;', '  return () => x;', '}'].join('\n'),
    );

    // Act
    const program = createProgramFromMap(sources);
    const findings = detectWaste(program);
    // Assert
    const xFindings = findings.filter(f => f.label === 'x');

    expect(xFindings.length).toBe(1);
    expect(xFindings[0]?.kind).toBe('dead-store');
  });
});
