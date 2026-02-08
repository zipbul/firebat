import FastBitSet from 'fastbitset';

import type { BitSet } from './types';

const createBitSet = (): BitSet => new FastBitSet();

const unionBitSet = (left: BitSet, right: BitSet): BitSet => left.new_union(right);

const intersectBitSet = (left: BitSet, right: BitSet): BitSet => left.new_intersection(right);

const subtractBitSet = (left: BitSet, right: BitSet): BitSet => {
  const next = left.clone();

  next.difference(right);

  return next;
};

const equalsBitSet = (left: BitSet, right: BitSet): boolean => left.equals(right);

export { createBitSet, equalsBitSet, intersectBitSet, subtractBitSet, unionBitSet };
