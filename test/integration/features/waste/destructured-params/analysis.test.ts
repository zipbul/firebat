import { describe, expect, it } from 'bun:test';

import { detectWaste } from '../../../../../src/test-api';
import { createProgramFromMap } from '../../../shared/test-kit';

describe('integration/waste/destructured-params', () => {
  it('should report dead-store when destructured parameter binding is never read', () => {
    // Arrange
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

    expect(unusedFindings.length).toBe(1);
    expect(unusedFindings[0]?.kind).toBe('dead-store');
  });
});
