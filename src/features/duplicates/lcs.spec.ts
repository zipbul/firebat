import { describe, expect, it } from 'bun:test';
import {
  computeLcsAlignment,
  computeLcsLength,
  computeSequenceSimilarity,
} from './lcs';

// ─── computeLcsLength ─────────────────────────────────────────────────────────

describe('computeLcsLength', () => {
  it('빈 배열 × 빈 배열 → 0', () => {
    expect(computeLcsLength([], [])).toBe(0);
  });

  it('빈 배열 × 비어 있지 않은 배열 → 0', () => {
    expect(computeLcsLength([], ['a', 'b'])).toBe(0);
    expect(computeLcsLength(['a', 'b'], [])).toBe(0);
  });

  it('동일 배열 → 배열 길이', () => {
    const a = ['a', 'b', 'c', 'd'];
    expect(computeLcsLength(a, a)).toBe(4);
  });

  it('완전 불일치 → 0', () => {
    expect(computeLcsLength(['a', 'b', 'c'], ['x', 'y', 'z'])).toBe(0);
  });

  it('한 쪽이 다른 쪽의 부분 시퀀스 → 짧은 쪽 길이', () => {
    expect(computeLcsLength(['a', 'c'], ['a', 'b', 'c', 'd'])).toBe(2);
  });

  it('앞에 원소 삽입', () => {
    expect(computeLcsLength(['a', 'b', 'c'], ['x', 'a', 'b', 'c'])).toBe(3);
  });

  it('중간에 원소 삽입', () => {
    expect(computeLcsLength(['a', 'b', 'c'], ['a', 'x', 'b', 'c'])).toBe(3);
  });

  it('뒤에 원소 삽입', () => {
    expect(computeLcsLength(['a', 'b', 'c'], ['a', 'b', 'c', 'x'])).toBe(3);
  });

  it('단일 원소 차이 n개 중 1개 — LCS = n-1', () => {
    const n = 5;
    const a = ['a', 'b', 'c', 'd', 'e'];
    const b = ['a', 'b', 'X', 'd', 'e'];
    expect(computeLcsLength(a, b)).toBe(n - 1);
  });

  it('중복 값 처리', () => {
    // a = [a, b, a], b = [a, a, b] → LCS = [a, b] 또는 [a, a] — 길이 2
    expect(computeLcsLength(['a', 'b', 'a'], ['a', 'a', 'b'])).toBe(2);
  });

  it('성능: 1000개 원소 < 100ms', () => {
    const size = 1000;
    const a = Array.from({ length: size }, (_, i) => `token-${i}`);
    const b = Array.from({ length: size }, (_, i) => `token-${i % 2 === 0 ? i : i + 1}`);

    const start = performance.now();
    computeLcsLength(a, b);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100);
  });
});

// ─── computeSequenceSimilarity ────────────────────────────────────────────────

describe('computeSequenceSimilarity', () => {
  it('빈 배열 × 빈 배열 → 0 (NaN 방지)', () => {
    expect(computeSequenceSimilarity([], [])).toBe(0);
  });

  it('동일 배열 → 1.0', () => {
    const a = ['a', 'b', 'c'];
    expect(computeSequenceSimilarity(a, a)).toBe(1.0);
  });

  it('완전 불일치 → 0.0', () => {
    expect(computeSequenceSimilarity(['a', 'b'], ['x', 'y'])).toBe(0.0);
  });

  it('단일 원소 배열 — 일치 → 1.0', () => {
    expect(computeSequenceSimilarity(['a'], ['a'])).toBe(1.0);
  });

  it('단일 원소 배열 — 불일치 → 0.0', () => {
    expect(computeSequenceSimilarity(['a'], ['b'])).toBe(0.0);
  });

  it('빈 배열 × 비어 있지 않은 배열 → 0.0', () => {
    expect(computeSequenceSimilarity([], ['a', 'b'])).toBe(0.0);
  });

  it('n개 중 1개 차이 — 유사도 = 2*(n-1)/(2n)', () => {
    const n = 6;
    const a = ['a', 'b', 'c', 'd', 'e', 'f'];
    const b = ['a', 'b', 'c', 'd', 'e', 'X'];
    const expected = (2 * (n - 1)) / (2 * n);
    expect(computeSequenceSimilarity(a, b)).toBeCloseTo(expected, 5);
  });

  it('범위 [0, 1] 보장', () => {
    const a = ['x', 'y', 'a', 'b'];
    const b = ['a', 'b', 'z', 'w'];
    const sim = computeSequenceSimilarity(a, b);
    expect(sim).toBeGreaterThanOrEqual(0);
    expect(sim).toBeLessThanOrEqual(1);
  });
});

// ─── computeLcsAlignment ──────────────────────────────────────────────────────

describe('computeLcsAlignment', () => {
  it('빈 배열 × 빈 배열 → 모두 빈 결과', () => {
    const result = computeLcsAlignment([], []);
    expect(result.matched).toHaveLength(0);
    expect(result.aOnly).toHaveLength(0);
    expect(result.bOnly).toHaveLength(0);
  });

  it('빈 A × 비어 있지 않은 B → bOnly만 존재', () => {
    const result = computeLcsAlignment([], ['x', 'y']);
    expect(result.matched).toHaveLength(0);
    expect(result.aOnly).toHaveLength(0);
    expect(result.bOnly).toEqual([0, 1]);
  });

  it('비어 있지 않은 A × 빈 B → aOnly만 존재', () => {
    const result = computeLcsAlignment(['x', 'y'], []);
    expect(result.matched).toHaveLength(0);
    expect(result.aOnly).toEqual([0, 1]);
    expect(result.bOnly).toHaveLength(0);
  });

  it('동일 배열 → 모두 matched, aOnly/bOnly 빈 배열', () => {
    const arr = ['a', 'b', 'c'];
    const result = computeLcsAlignment(arr, arr);
    expect(result.matched).toHaveLength(3);
    expect(result.matched[0]).toEqual({ aIndex: 0, bIndex: 0 });
    expect(result.matched[1]).toEqual({ aIndex: 1, bIndex: 1 });
    expect(result.matched[2]).toEqual({ aIndex: 2, bIndex: 2 });
    expect(result.aOnly).toHaveLength(0);
    expect(result.bOnly).toHaveLength(0);
  });

  it('완전 불일치 → aOnly/bOnly에 모두 포함', () => {
    const a = ['a', 'b'];
    const b = ['x', 'y', 'z'];
    const result = computeLcsAlignment(a, b);
    expect(result.matched).toHaveLength(0);
    expect(result.aOnly).toEqual([0, 1]);
    expect(result.bOnly).toEqual([0, 1, 2]);
  });

  it('앞에 원소 삽입 — 삽입된 인덱스만 bOnly에 포함', () => {
    const a = ['b', 'c'];
    const b = ['x', 'b', 'c'];
    const result = computeLcsAlignment(a, b);
    expect(result.matched).toHaveLength(2);
    expect(result.aOnly).toHaveLength(0);
    expect(result.bOnly).toEqual([0]); // 'x' 만 bOnly
  });

  it('중간에 원소 삽입 — 삽입된 인덱스만 bOnly에 포함', () => {
    const a = ['a', 'c'];
    const b = ['a', 'x', 'c'];
    const result = computeLcsAlignment(a, b);
    expect(result.matched).toHaveLength(2);
    expect(result.aOnly).toHaveLength(0);
    expect(result.bOnly).toEqual([1]); // 'x' 만 bOnly
  });

  it('뒤에 원소 삽입 — 삽입된 인덱스만 bOnly에 포함', () => {
    const a = ['a', 'b'];
    const b = ['a', 'b', 'x'];
    const result = computeLcsAlignment(a, b);
    expect(result.matched).toHaveLength(2);
    expect(result.aOnly).toHaveLength(0);
    expect(result.bOnly).toEqual([2]); // 'x' 만 bOnly
  });

  it('matched 결과가 오름차순 정렬됨', () => {
    const a = ['a', 'b', 'c', 'd'];
    const b = ['d', 'a', 'b', 'c'];
    const result = computeLcsAlignment(a, b);
    for (let i = 1; i < result.matched.length; i++) {
      expect(result.matched[i]!.aIndex).toBeGreaterThan(result.matched[i - 1]!.aIndex);
      expect(result.matched[i]!.bIndex).toBeGreaterThan(result.matched[i - 1]!.bIndex);
    }
  });

  it('aOnly + bOnly + matched 인덱스로 원본 배열 완전 복원 가능', () => {
    const a = ['a', 'x', 'b', 'c'];
    const b = ['a', 'b', 'y', 'c'];
    const result = computeLcsAlignment(a, b);

    const aIndexes = new Set([
      ...result.matched.map((m) => m.aIndex),
      ...result.aOnly,
    ]);
    const bIndexes = new Set([
      ...result.matched.map((m) => m.bIndex),
      ...result.bOnly,
    ]);

    // 모든 A 인덱스가 포함됨
    for (let i = 0; i < a.length; i++) expect(aIndexes.has(i)).toBe(true);
    // 모든 B 인덱스가 포함됨
    for (let j = 0; j < b.length; j++) expect(bIndexes.has(j)).toBe(true);
    // matched의 값이 실제로 일치함
    for (const { aIndex, bIndex } of result.matched) {
      expect(a[aIndex]).toBe(b[bIndex]);
    }
  });

  it('matched 길이 = computeLcsLength 결과와 동일', () => {
    const a = ['a', 'b', 'c', 'd', 'e'];
    const b = ['b', 'x', 'c', 'y', 'e'];
    const result = computeLcsAlignment(a, b);
    const length = computeLcsLength(a, b);
    expect(result.matched).toHaveLength(length);
  });
});
