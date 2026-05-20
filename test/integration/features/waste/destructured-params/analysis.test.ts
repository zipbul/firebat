import { describe, expect, it } from 'bun:test';

import { detectWaste } from '../../../../../src/test-api';
import { createProgramFromMap } from '../../../shared/test-kit';

describe('integration/waste/destructured-params', () => {
  it('should NOT report dead-store for destructured parameter binding (CLAUDE.md: 함수 파라미터 비대상)', () => {
    // Function parameters — including bindings inside a destructured parameter pattern —
    // are explicitly excluded from waste by CLAUDE.md. Unused parameter names belong to
    // the no-unused-vars detector domain, not waste.
    const sources = new Map<string, string>();

    sources.set(
      '/virtual/waste/destructured-params.ts',
      ['export function render({ title, description, unused }) {', '  return `${title}:${description}`;', '}'].join('\n'),
    );

    // Act
    const program = createProgramFromMap(sources);
    const findings = detectWaste(program);
    // Assert
    const unusedFindings = findings.filter(f => f.label === 'unused');

    expect(unusedFindings.length).toBe(0);
  });
});
