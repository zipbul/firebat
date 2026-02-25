import { describe, expect, it } from 'bun:test';

import { analyzeDuplicates } from '../../../../src/test-api';
import { createProgramFromMap } from '../../shared/test-kit';

function createFunctionSource(name: string, value: number): string {
  return [`export function ${name}() {`, `  const localValue = ${value};`, '  return localValue + 1;', '}'].join('\n');
}

describe('integration/duplicates', () => {
  it('should detect exact-clone groups when functions are identical', () => {
    const sources = new Map<string, string>();

    sources.set('/virtual/dup/one.ts', createFunctionSource('alpha', 1));
    sources.set('/virtual/dup/two.ts', createFunctionSource('alpha', 1));

    const program = createProgramFromMap(sources);
    const groups = analyzeDuplicates(program, { minSize: 1 });
    const hasGroup = groups.some(group => group.items.length >= 2);

    expect(hasGroup).toBe(true);
  });

  it('should not group functions when minSize is too high', () => {
    const sources = new Map<string, string>();

    sources.set('/virtual/dup/one.ts', createFunctionSource('alpha', 1));
    sources.set('/virtual/dup/two.ts', createFunctionSource('alpha', 1));

    const program = createProgramFromMap(sources);
    const groups = analyzeDuplicates(program, { minSize: 500 });

    expect(groups.length).toBe(0);
  });

  it('should not group near-duplicates when literals differ', () => {
    const sources = new Map<string, string>();

    sources.set('/virtual/dup/one.ts', createFunctionSource('alpha', 1));
    sources.set('/virtual/dup/two.ts', createFunctionSource('alpha', 2));

    const program = createProgramFromMap(sources);
    const groups = analyzeDuplicates(program, { minSize: 1 });

    expect(groups.length).toBe(0);
  });

  it('should detect structural-clone groups when structures match but literals differ', () => {
    const sources = new Map<string, string>();

    // Same shape, different function name + value → structural duplicate
    sources.set('/virtual/dup/one.ts', createFunctionSource('alpha', 1));
    sources.set('/virtual/dup/two.ts', createFunctionSource('beta', 2));

    const program = createProgramFromMap(sources);
    const groups = analyzeDuplicates(program, { minSize: 1 });
    const hasStructural = groups.some(g => g.items.length >= 2 && g.findingKind !== 'exact-clone');

    expect(hasStructural).toBe(true);
  });

  it('each group should have required findingKind field', () => {
    const sources = new Map<string, string>();

    sources.set('/virtual/dup/one.ts', createFunctionSource('alpha', 1));
    sources.set('/virtual/dup/two.ts', createFunctionSource('alpha', 1));

    const program = createProgramFromMap(sources);
    const groups = analyzeDuplicates(program, { minSize: 1 });

    for (const group of groups) {
      expect(typeof group.findingKind).toBe('string');
      expect(group.findingKind.length).toBeGreaterThan(0);
    }
  });
});
