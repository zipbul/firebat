import { describe, it, expect } from 'bun:test';

import {
  addIdsToBitSet,
  createBitSet,
  createBitSetArray,
  equalsBitSet,
  intersectBitSet,
  subtractBitSet,
  unionBitSet,
  unionByIndices,
} from './dataflow';

interface EqualsBitSetCase {
  name: string;
  aBits: number[];
  bBits: number[];
  equal: boolean;
}

describe('createBitSet', () => {
  it('creates an empty bit set', () => {
    const bs = createBitSet();

    expect(bs.array().length).toBe(0);
  });
});

describe('unionBitSet', () => {
  it('combines bits from both sets', () => {
    const a = createBitSet();
    const b = createBitSet();

    a.add(1);
    b.add(2);

    const result = unionBitSet(a, b);

    expect(result.has(1)).toBe(true);
    expect(result.has(2)).toBe(true);
  });

  it('does not mutate inputs', () => {
    const a = createBitSet();
    const b = createBitSet();

    a.add(1);
    b.add(2);
    unionBitSet(a, b);
    expect(a.has(2)).toBe(false);
  });
});

describe('intersectBitSet', () => {
  it('returns bits present in both sets', () => {
    const a = createBitSet();
    const b = createBitSet();

    a.add(1);
    a.add(2);
    b.add(2);
    b.add(3);

    const result = intersectBitSet(a, b);

    expect(result.has(1)).toBe(false);
    expect(result.has(2)).toBe(true);
    expect(result.has(3)).toBe(false);
  });
});

describe('subtractBitSet', () => {
  it('removes bits present in the right set', () => {
    const a = createBitSet();
    const b = createBitSet();

    a.add(1);
    a.add(2);
    b.add(2);

    const result = subtractBitSet(a, b);

    expect(result.has(1)).toBe(true);
    expect(result.has(2)).toBe(false);
  });

  it('does not mutate the left set', () => {
    const a = createBitSet();
    const b = createBitSet();

    a.add(1);
    b.add(1);
    subtractBitSet(a, b);
    expect(a.has(1)).toBe(true);
  });
});

describe('equalsBitSet', () => {
  const cases: EqualsBitSetCase[] = [
    { name: 'returns true for two empty sets', aBits: [], bBits: [], equal: true },
    { name: 'returns true for sets with same bits', aBits: [5], bBits: [5], equal: true },
    { name: 'returns false for sets with different bits', aBits: [1], bBits: [2], equal: false },
  ];

  it.each(cases)('$name', ({ aBits, bBits, equal }) => {
    const a = createBitSet();
    const b = createBitSet();

    addIdsToBitSet(a, aBits);
    addIdsToBitSet(b, bBits);

    expect(equalsBitSet(a, b)).toBe(equal);
  });
});

// Build an array of bit sets, one per id-list, dogfooding the helpers under test.
const bitSetsOf = (...idLists: ReadonlyArray<ReadonlyArray<number>>) => {
  const arr = createBitSetArray(idLists.length);

  idLists.forEach((ids, index) => addIdsToBitSet(arr[index], ids));

  return arr;
};

describe('createBitSetArray', () => {
  it.each([{ length: 3 }, { length: 0 }])('allocates $length empty bit sets', ({ length }) => {
    const arr = createBitSetArray(length);

    expect(arr.length === length && arr.every(bs => bs.array().length === 0)).toBe(true);
  });

  it('allocates distinct bit sets (mutating one does not affect another)', () => {
    const [first, second] = bitSetsOf([7], []);

    expect(first!.has(7) && !second!.has(7)).toBe(true);
  });
});

describe('addIdsToBitSet', () => {
  it.each<{ name: string; ids: number[]; expected: number[] }>([
    { name: 'adds every id', ids: [1, 4, 9], expected: [1, 4, 9] },
    { name: 'is a no-op for an empty list', ids: [], expected: [] },
  ])('$name', ({ ids, expected }) => {
    const [bs] = bitSetsOf(ids);

    // FastBitSet.array() yields indices in ascending order.
    expect(bs!.array()).toEqual(expected);
  });

  it('does nothing when the target is undefined', () => {
    expect(() => addIdsToBitSet(undefined, [1, 2])).not.toThrow();
  });
});

describe('unionByIndices', () => {
  it.each<{ name: string; indices: number[]; expected: number[] }>([
    { name: 'unions only the selected sets', indices: [0, 2], expected: [1, 3] },
    { name: 'returns empty for no indices', indices: [], expected: [] },
    { name: 'skips index slots that hold no set', indices: [0, 1, 2], expected: [1, 3] },
  ])('$name', ({ indices, expected }) => {
    const byIndex = bitSetsOf([1], [], [3]);
    const result = unionByIndices(createBitSet(), indices, byIndex);

    expect(result.array()).toEqual(expected);
  });
});
