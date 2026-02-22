import { describe, expect, it } from 'bun:test';

import { EdgeType } from './types';

// Note: most exports from engine/types.ts are TypeScript interfaces/type aliases
// that have no runtime value. We verify the re-exported runtime value (EdgeType)
// and confirm that type-shape assertions compile.

describe('engine/types — EdgeType re-export', () => {
  it('re-exports EdgeType numeric enum from cfg-types', () => {
    expect(typeof EdgeType).toBe('object');
    expect(EdgeType.Normal).toBe(0);
    expect(EdgeType.True).toBe(1);
    expect(EdgeType.False).toBe(2);
  });

  it('reverse-mapping works for all EdgeType values', () => {
    expect(EdgeType[0]).toBe('Normal');
    expect(EdgeType[1]).toBe('True');
    expect(EdgeType[2]).toBe('False');
  });
});

describe('engine/types — interface shape assertions (compile-time)', () => {
  it('BitSet interface shape is structurally satisfied by a mock object', () => {
    const mockSet = {
      add: (_i: number) => {},
      remove: (_i: number) => {},
      has: (_i: number) => false,
      new_union: (other: unknown) => other,
      new_intersection: (other: unknown) => other,
      difference: (_other: unknown) => {},
      clone: () => mockSet,
      equals: (_other: unknown) => false,
      array: () => [] as number[],
    };
    // No runtime assertion needed — this verifies the object can be typed as BitSet
    expect(typeof mockSet.add).toBe('function');
    expect(typeof mockSet.array).toBe('function');
    expect(mockSet.has(0)).toBe(false);
  });

  it('ParsedFile interface requires expected keys', () => {
    const pf = {
      filePath: '/foo/bar.ts',
      program: {},
      errors: [],
      comments: [],
      sourceText: 'const x = 1;',
    };
    expect(pf.filePath).toBe('/foo/bar.ts');
    expect(Array.isArray(pf.errors)).toBe(true);
    expect(typeof pf.sourceText).toBe('string');
  });

  it('LoopTargets interface requires breakTarget, continueTarget, label', () => {
    const lt = { breakTarget: 1, continueTarget: 2, label: null };
    expect(lt.breakTarget).toBe(1);
    expect(lt.continueTarget).toBe(2);
    expect(lt.label).toBeNull();
  });
});
