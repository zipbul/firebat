import { describe, expect, it } from 'bun:test';

import { detectWasteLabelFindings } from '../_shared';

describe('integration/waste/destructured-params', () => {
  it('should NOT report dead-store for destructured parameter binding (CLAUDE.md: 함수 파라미터 비대상)', () => {
    // Function parameters — including bindings inside a destructured parameter pattern —
    // are explicitly excluded from waste by CLAUDE.md. Unused parameter names belong to
    // the no-unused-vars detector domain, not waste.
    const source = ['export function render({ title, description, unused }) {', '  return `${title}:${description}`;', '}'].join(
      '\n',
    );
    // Act
    const unusedFindings = detectWasteLabelFindings('/virtual/waste/destructured-params.ts', source, 'unused');

    // Assert
    expect(unusedFindings.length).toBe(0);
  });
});
