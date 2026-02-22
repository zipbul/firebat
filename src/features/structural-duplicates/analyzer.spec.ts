import { mock, afterAll, describe, it, expect, beforeEach } from 'bun:test';
import path from 'node:path';
import type { DuplicateGroup } from '../../types';

const detectClonesMock = mock(
  (_files: unknown, _minSize: unknown, _type: unknown): DuplicateGroup[] => [],
);

const __origDuplicateDetector = { ...require(path.resolve(import.meta.dir, '../../engine/duplicate-detector.ts')) };

mock.module(path.resolve(import.meta.dir, '../../engine/duplicate-detector.ts'), () => ({
  detectClones: detectClonesMock,
}));

const { analyzeStructuralDuplicates, createEmptyStructuralDuplicates } = await import('./analyzer');

const makeGroup = (cloneType: string, itemCount: number): DuplicateGroup =>
  ({
    cloneType,
    items: Array.from({ length: itemCount }, (_, i) => ({ id: i })),
  }) as unknown as DuplicateGroup;

describe('createEmptyStructuralDuplicates', () => {
  it('returns an empty array', () => {
    expect(createEmptyStructuralDuplicates()).toEqual([]);
  });
});

describe('analyzeStructuralDuplicates', () => {
  beforeEach(() => {
    detectClonesMock.mockReset();
    detectClonesMock.mockImplementation(() => []);
  });

  it('[ED] returns [] when files array is empty', () => {
    const result = analyzeStructuralDuplicates([], 10);
    expect(result).toEqual([]);
    expect(detectClonesMock).not.toHaveBeenCalled();
  });

  it('[HP] passes minSize to detectClones', () => {
    const files = [{ path: 'a.ts' }] as unknown as Parameters<typeof analyzeStructuralDuplicates>[0];
    analyzeStructuralDuplicates(files, 42);
    expect(detectClonesMock).toHaveBeenCalledWith(files, 42, 'type-2-shape');
    expect(detectClonesMock).toHaveBeenCalledWith(files, 42, 'type-3-normalized');
  });

  it('[HP] returns single group from detectClones pass-through', () => {
    const group = makeGroup('type-2-shape', 3);
    detectClonesMock.mockImplementation((_f, _m, type) =>
      type === 'type-2-shape' ? [group] : [],
    );
    const result = analyzeStructuralDuplicates([{} as never], 10);
    expect(result).toEqual([group]);
  });

  it('[HP] merges results from both clone types', () => {
    const g1 = makeGroup('type-2-shape', 2);
    const g2 = makeGroup('type-3-normalized', 3);
    detectClonesMock.mockImplementation((_f, _m, type) =>
      type === 'type-2-shape' ? [g1] : [g2],
    );
    const result = analyzeStructuralDuplicates([{} as never], 10);
    expect(result).toHaveLength(2);
    expect(result).toContain(g1);
    expect(result).toContain(g2);
  });

  it('[HP] sorts merged results by items.length descending', () => {
    const small = makeGroup('type-2-shape', 1);
    const large = makeGroup('type-3-normalized', 5);
    detectClonesMock.mockImplementation((_f, _m, type) =>
      type === 'type-2-shape' ? [small] : [large],
    );
    const result = analyzeStructuralDuplicates([{} as never], 10);
    expect(result[0]).toBe(large);
    expect(result[1]).toBe(small);
  });

  it('[CO] sorts by cloneType alphabetically when items.length is equal', () => {
    const b = makeGroup('type-3-normalized', 2);
    const a = makeGroup('type-2-shape', 2);
    detectClonesMock.mockImplementation((_f, _m, type) =>
      type === 'type-2-shape' ? [a] : [b],
    );
    const result = analyzeStructuralDuplicates([{} as never], 10);
    // 'type-2-shape' < 'type-3-normalized' alphabetically
    expect(result[0]).toBe(a);
    expect(result[1]).toBe(b);
  });
});

afterAll(() => {
  mock.restore();
  mock.module(path.resolve(import.meta.dir, '../../engine/duplicate-detector.ts'), () => __origDuplicateDetector);
});
