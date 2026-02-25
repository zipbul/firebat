import { describe, expect, it } from 'bun:test';
import {
  createMinHasher,
  estimateJaccard,
  findLshCandidates,
} from './minhash';

// ─── computeSignature ─────────────────────────────────────────────────────────

describe('MinHasher.computeSignature', () => {
  it('빈 bag → 에러 없이 길이 k 시그니처 반환', () => {
    const hasher = createMinHasher(16);
    const sig = hasher.computeSignature([]);
    expect(sig).toHaveLength(16);
  });

  it('기본 k=128', () => {
    const hasher = createMinHasher();
    expect(hasher.k).toBe(128);
    const sig = hasher.computeSignature(['a']);
    expect(sig).toHaveLength(128);
  });

  it('동일 bag → 시그니처 완전 동일', () => {
    const hasher = createMinHasher(32);
    const bag = ['stmt-1', 'stmt-2', 'stmt-3', 'stmt-4', 'stmt-5'];
    const sigA = hasher.computeSignature(bag);
    const sigB = hasher.computeSignature([...bag]);
    expect(sigA).toEqual(sigB);
  });

  it('완전 불일치 bag → 시그니처 대부분 다름', () => {
    const hasher = createMinHasher(128);
    const bagA = Array.from({ length: 50 }, (_, i) => `a-stmt-${i}`);
    const bagB = Array.from({ length: 50 }, (_, i) => `b-stmt-${i}`);
    const sigA = hasher.computeSignature(bagA);
    const sigB = hasher.computeSignature(bagB);
    // 추정 Jaccard ≈ 0 (50개 중 겹치는 것 없음)
    const jaccard = estimateJaccard(sigA, sigB);
    expect(jaccard).toBeLessThan(0.05);
  });

  it('부분 겹침 bag → 추정 Jaccard가 실제 Jaccard에 근사', () => {
    const hasher = createMinHasher(512); // 더 정확한 근사를 위해 큰 k
    // 공통 60개, A만 20개, B만 20개 → Jaccard = 60/(60+20+20) = 0.6
    const common = Array.from({ length: 60 }, (_, i) => `common-${i}`);
    const onlyA = Array.from({ length: 20 }, (_, i) => `a-only-${i}`);
    const onlyB = Array.from({ length: 20 }, (_, i) => `b-only-${i}`);
    const bagA = [...common, ...onlyA];
    const bagB = [...common, ...onlyB];
    const sigA = hasher.computeSignature(bagA);
    const sigB = hasher.computeSignature(bagB);
    const jaccard = estimateJaccard(sigA, sigB);
    // k=512이면 오차 < ±0.05 기대
    expect(jaccard).toBeGreaterThan(0.55);
    expect(jaccard).toBeLessThan(0.65);
  });

  it('단일 원소 bag → 시그니처 일관성', () => {
    const hasher = createMinHasher(32);
    const sig1 = hasher.computeSignature(['hello']);
    const sig2 = hasher.computeSignature(['hello']);
    expect(sig1).toEqual(sig2);
  });

  it('원소 순서 무관 — bag이므로 동일 시그니처', () => {
    const hasher = createMinHasher(64);
    const bagA = ['x', 'y', 'z'];
    const bagB = ['z', 'x', 'y'];
    const sigA = hasher.computeSignature(bagA);
    const sigB = hasher.computeSignature(bagB);
    // bag semantics: 순서 다르지만 동일 원소 → 동일 시그니처
    expect(sigA).toEqual(sigB);
  });
});

// ─── estimateJaccard ──────────────────────────────────────────────────────────

describe('estimateJaccard', () => {
  it('빈 시그니처 → 0', () => {
    expect(estimateJaccard([], [])).toBe(0);
  });

  it('동일 시그니처 → 1.0', () => {
    const sig = [1n, 2n, 3n, 4n];
    expect(estimateJaccard(sig, sig)).toBe(1.0);
  });

  it('완전 불일치 시그니처 → 0.0', () => {
    const sigA = [1n, 2n, 3n, 4n];
    const sigB = [5n, 6n, 7n, 8n];
    expect(estimateJaccard(sigA, sigB)).toBe(0.0);
  });

  it('절반 일치 → 0.5', () => {
    const sigA = [1n, 2n, 3n, 4n];
    const sigB = [1n, 2n, 5n, 6n];
    expect(estimateJaccard(sigA, sigB)).toBe(0.5);
  });
});

// ─── findLshCandidates ────────────────────────────────────────────────────────

describe('findLshCandidates', () => {
  it('빈 배열 → 빈 결과', () => {
    expect(findLshCandidates([])).toHaveLength(0);
  });

  it('단일 시그니처 → 빈 결과 (쌍 불가)', () => {
    const hasher = createMinHasher();
    const sig = hasher.computeSignature(['a', 'b']);
    expect(findLshCandidates([sig])).toHaveLength(0);
  });

  it('동일 시그니처 2개 → 반드시 후보 쌍 포함', () => {
    const hasher = createMinHasher();
    const bag = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const sig = hasher.computeSignature(bag);
    // 완전히 동일한 시그니처 → 모든 band에서 같은 버킷
    const candidates = findLshCandidates([sig, sig]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toEqual({ i: 0, j: 1 });
  });

  it('동일 bag에서 생성한 두 시그니처 → 반드시 후보 쌍 포함', () => {
    const hasher = createMinHasher();
    const bag = Array.from({ length: 20 }, (_, i) => `stmt-${i}`);
    const sigA = hasher.computeSignature(bag);
    const sigB = hasher.computeSignature([...bag]); // 같은 내용 다른 배열
    const candidates = findLshCandidates([sigA, sigB]);
    const hasPair = candidates.some((c) => c.i === 0 && c.j === 1);
    expect(hasPair).toBe(true);
  });

  it('후보 쌍은 i < j 보장', () => {
    const hasher = createMinHasher();
    const bags = Array.from({ length: 5 }, (_, b) =>
      Array.from({ length: 10 }, (_, i) => `bag${b}-${i}`),
    );
    const signatures = bags.map((bag) => hasher.computeSignature(bag));
    const candidates = findLshCandidates(signatures);
    for (const { i, j } of candidates) {
      expect(i).toBeLessThan(j);
    }
  });

  it('후보 쌍 중복 없음', () => {
    const hasher = createMinHasher();
    const common = Array.from({ length: 20 }, (_, i) => `common-${i}`);
    const bags = [
      common,
      common,
      common,
      Array.from({ length: 20 }, (_, i) => `other-${i}`),
    ];
    const signatures = bags.map((bag) => hasher.computeSignature(bag));
    const candidates = findLshCandidates(signatures);
    const keys = candidates.map(({ i, j }) => `${i}-${j}`);
    const uniqueKeys = new Set(keys);
    expect(keys.length).toBe(uniqueKeys.size);
  });

  it('성능: 500개 bag, k=128 → < 500ms', () => {
    const hasher = createMinHasher(128);
    const bagCount = 500;
    const itemsPerBag = 20;
    const signatures = Array.from({ length: bagCount }, (_, b) => {
      const bag = Array.from({ length: itemsPerBag }, (_, i) => `bag${b}-item${i}`);
      return hasher.computeSignature(bag);
    });

    const start = performance.now();
    findLshCandidates(signatures);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(500);
  });

  it('성능: 시그니처 계산 1000개 bag, k=128 → < 1000ms', () => {
    const hasher = createMinHasher(128);
    const start = performance.now();
    for (let b = 0; b < 1000; b++) {
      const bag = Array.from({ length: 15 }, (_, i) => `bag${b}-stmt${i}`);
      hasher.computeSignature(bag);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});
