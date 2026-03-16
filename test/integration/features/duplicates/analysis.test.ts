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

  it('should detect shape group when functions have same name but different literals', () => {
    const sources = new Map<string, string>();

    sources.set('/virtual/dup/one.ts', createFunctionSource('alpha', 1));
    sources.set('/virtual/dup/two.ts', createFunctionSource('alpha', 2));

    const program = createProgramFromMap(sources);
    const groups = analyzeDuplicates(program, { minSize: 1 });
    // Shape fingerprint strips both identifiers and literals → same shape → shape group
    const hasShapeGroup = groups.some(g => g.items.length >= 2 && g.cloneType === 'shape');

    expect(hasShapeGroup).toBe(true);

    // Should NOT be exact-clone (literal differs)
    const hasExactClone = groups.some(g => g.items.length >= 2 && g.cloneType === 'exact');

    expect(hasExactClone).toBe(false);
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

  it('should not double-report class and its method as separate groups', () => {
    const sources = new Map<string, string>();
    const classSource = [
      'export class Calculator {',
      '  compute(x: number): number {',
      '    const doubled = x * 2;',
      '    const tripled = doubled + x;',
      '    return tripled;',
      '  }',
      '}',
    ].join('\n');

    sources.set('/virtual/dup/one.ts', classSource);
    sources.set('/virtual/dup/two.ts', classSource);

    const program = createProgramFromMap(sources);
    const groups = analyzeDuplicates(program, { minSize: 1 });
    // Class 그룹이 존재해야 함
    const classGroups = groups.filter(g => g.items.some(i => i.kind === 'type'));

    expect(classGroups.length).toBeGreaterThanOrEqual(1);

    // Method만으로 이루어진 그룹은 없어야 함 (Class에 포함되므로 subsumed)
    const methodOnlyGroups = groups.filter(g => g.items.every(i => i.kind === 'method'));

    expect(methodOnlyGroups.length).toBe(0);
  });
});
