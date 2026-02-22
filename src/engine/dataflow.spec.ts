import { describe, it, expect } from 'bun:test';

import { createBitSet, equalsBitSet, intersectBitSet, subtractBitSet, unionBitSet } from './dataflow';

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
  it('returns true for two empty sets', () => {
    expect(equalsBitSet(createBitSet(), createBitSet())).toBe(true);
  });

  it('returns true for sets with same bits', () => {
    const a = createBitSet();
    const b = createBitSet();
    a.add(5);
    b.add(5);
    expect(equalsBitSet(a, b)).toBe(true);
  });

  it('returns false for sets with different bits', () => {
    const a = createBitSet();
    const b = createBitSet();
    a.add(1);
    b.add(2);
    expect(equalsBitSet(a, b)).toBe(false);
  });
});
