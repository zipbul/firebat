import { describe, expect, it } from 'bun:test';

import { detectWasteLabelFindings } from '../_shared';

describe('integration/waste/closure-overwritten', () => {
  it('should still report dead-store for overwritten defs that do not reach the closure', () => {
    // The first `x = 1` is overwritten by `x = 2` before any read (the closure returns
    // the current x, which by the time it runs is the latest binding). Waste reports
    // the first def as overwritten.
    const source = ['export function example() {', '  let x = 1;', '  x = 2;', '  return () => x;', '}'].join('\n');
    // Act
    const xFindings = detectWasteLabelFindings('/virtual/waste/closure-overwritten.ts', source, 'x');

    // Assert
    expect(xFindings.length).toBe(1);
    expect(xFindings[0]?.kind).toMatch(/dead-store/);
  });
});
