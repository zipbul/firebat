import { describe, expect, it } from 'bun:test';

import type { DuplicateGroup } from '../../../../src/test-api';

import { analyzeDuplicates } from '../../../../src/test-api';
import { createProgramFromMap } from '../../shared/test-kit';

function createFunctionSource(name: string, value: number): string {
  return [`export function ${name}() {`, `  const localValue = ${value};`, '  return localValue + 1;', '}'].join('\n');
}

interface FnSpec {
  name: string;
  value: number;
}

const analyzeTwoFunctions = (one: FnSpec, two: FnSpec, minSize: number): readonly DuplicateGroup[] => {
  const sources = new Map<string, string>();

  sources.set('/virtual/dup/one.ts', createFunctionSource(one.name, one.value));
  sources.set('/virtual/dup/two.ts', createFunctionSource(two.name, two.value));

  const program = createProgramFromMap(sources);

  return analyzeDuplicates(program, { minSize });
};

describe('integration/duplicates', () => {
  interface DetectCase {
    title: string;
    one: FnSpec;
    two: FnSpec;
    matches: (g: DuplicateGroup) => boolean;
  }

  const detectCases: DetectCase[] = [
    {
      title: 'should detect exact-clone groups when functions are identical',
      one: { name: 'alpha', value: 1 },
      two: { name: 'alpha', value: 1 },
      matches: g => g.items.length >= 2,
    },
    {
      // Shape fingerprint strips both identifiers and literals → same shape → shape group
      title: 'should detect shape group when functions have same name but different literals',
      one: { name: 'alpha', value: 1 },
      two: { name: 'alpha', value: 2 },
      matches: g => g.items.length >= 2 && g.cloneType === 'shape',
    },
    {
      // Same shape, different function name + value → structural duplicate
      title: 'should detect structural-clone groups when structures match but literals differ',
      one: { name: 'alpha', value: 1 },
      two: { name: 'beta', value: 2 },
      matches: g => g.items.length >= 2 && g.findingKind !== 'exact-clone',
    },
  ];

  it.each(detectCases)('$title', ({ one, two, matches }) => {
    const groups = analyzeTwoFunctions(one, two, 1);

    expect(groups.some(matches)).toBe(true);
  });

  it('should not group functions when minSize is too high', () => {
    const groups = analyzeTwoFunctions({ name: 'alpha', value: 1 }, { name: 'alpha', value: 1 }, 500);

    expect(groups.length).toBe(0);
  });

  it('should not detect exact-clone when literals differ', () => {
    const groups = analyzeTwoFunctions({ name: 'alpha', value: 1 }, { name: 'alpha', value: 2 }, 1);
    const hasExactClone = groups.some(g => g.items.length >= 2 && g.cloneType === 'exact');

    expect(hasExactClone).toBe(false);
  });

  it('each group should have required findingKind field', () => {
    const groups = analyzeTwoFunctions({ name: 'alpha', value: 1 }, { name: 'alpha', value: 1 }, 1);

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
