import FastBitSet from 'fastbitset';

import type { BitSet } from '../types';

const createBitSet = (): BitSet => new FastBitSet();

/** `length`개의 빈 BitSet 배열을 새로 할당한다 — 데이터플로 패스의 per-node/per-var 집합 초기화 단일 결정. */
const createBitSetArray = (length: number): BitSet[] => Array.from({ length }, createBitSet);

const unionBitSet = (left: BitSet, right: BitSet): BitSet => left.new_union(right);

const intersectBitSet = (left: BitSet, right: BitSet): BitSet => left.new_intersection(right);

const subtractBitSet = (left: BitSet, right: BitSet): BitSet => {
  const next = left.clone();

  next.difference(right);

  return next;
};

const equalsBitSet = (left: BitSet, right: BitSet): boolean => left.equals(right);

/**
 * `indices`가 가리키는 `byIndex`의 BitSet들을 `acc`에 합집합으로 누적한 새 BitSet을
 * 반환한다 (빈 슬롯은 건너뜀). liveness의 successor live-in 합과 reaching-defs의 kill
 * 집합 누적이 공유하는 "인덱스로 고른 집합들의 합" 단일 결정.
 */
const unionByIndices = (acc: BitSet, indices: Iterable<number>, byIndex: ReadonlyArray<BitSet>): BitSet => {
  let result = acc;

  for (const index of indices) {
    const set = byIndex[index];

    if (set) {
      result = unionBitSet(result, set);
    }
  }

  return result;
};

/** `ids`를 `target` BitSet에 모두 추가 (target이 없으면 무시). 버킷 id 목록을 비트셋으로 채우는 단일 결정. */
const addIdsToBitSet = (target: BitSet | undefined, ids: ReadonlyArray<number>): void => {
  if (!target) {
    return;
  }

  for (const id of ids) {
    target.add(id);
  }
};

export {
  addIdsToBitSet,
  createBitSet,
  createBitSetArray,
  equalsBitSet,
  intersectBitSet,
  subtractBitSet,
  unionByIndices,
  unionBitSet,
};
