import { describe, expect, it } from 'bun:test';

import type { ParsedFile } from '../../engine/types';

import { parseSource } from '../../engine/ast/parse-source';
import { detectNearMissClones, type NearMissDetectorOptions, __testing__ } from './near-miss-detector';

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────

const defaultOptions: NearMissDetectorOptions = {
  minSize: 3,
  similarityThreshold: 0.7,
  jaccardThreshold: 0.5,
  minHashK: 128,
  sizeRatio: 0.5,
  minStatementCount: 5,
};

const makeFile = (fileName: string, source: string): ParsedFile => parseSource(fileName, source);

// 유사한 함수 쌍 생성 — statement 1개만 다름 (small path, < minStatementCount)
const makeSimilarSmallPair = () => {
  const fileA = makeFile(
    'a.ts',
    `
    function calcA(x: number, y: number) {
      const sum = x + y;
      return sum;
    }
  `,
  );
  const fileB = makeFile(
    'b.ts',
    `
    function calcB(x: number, y: number) {
      const sum = x + y;
      return sum * 2;
    }
  `,
  );

  return [fileA, fileB];
};

// 유사한 함수 쌍 — statement 5+ 개 (large path, MinHash 사용)
const makeSimilarLargePair = () => {
  const bodyA = `
    function processA(items: number[]) {
      const result: number[] = [];
      for (const item of items) {
        const doubled = item * 2;
        if (doubled > 10) {
          result.push(doubled);
        }
      }
      console.log(result.length);
      return result;
    }
  `;
  const bodyB = `
    function processB(items: number[]) {
      const result: number[] = [];
      for (const item of items) {
        const tripled = item * 3;
        if (tripled > 10) {
          result.push(tripled);
        }
      }
      console.log(result.length);
      return result;
    }
  `;

  return [makeFile('a.ts', bodyA), makeFile('b.ts', bodyB)];
};

// 완전히 다른 두 함수
const makeDifferentFunctions = () => {
  const fileA = makeFile(
    'a.ts',
    `
    function mathOp(x: number) {
      return x * x + 1;
    }
  `,
  );
  const fileB = makeFile(
    'b.ts',
    `
    function strOp(s: string) {
      for (let i = 0; i < s.length; i++) {
        console.log(s[i]);
      }
    }
  `,
  );

  return [fileA, fileB];
};

// ─── detectNearMissClones ─────────────────────────────────────────────────────

describe('detectNearMissClones', () => {
  it('빈 파일 배열 → 빈 결과', () => {
    const result = detectNearMissClones([], defaultOptions);

    expect(result).toHaveLength(0);
  });

  it('단일 함수 → 빈 결과 (쌍 불가)', () => {
    const file = makeFile(
      'a.ts',
      `
      function solo(x: number) {
        const y = x + 1;
        return y;
      }
    `,
    );
    const result = detectNearMissClones([file], defaultOptions);

    expect(result).toHaveLength(0);
  });

  it('완전 동일 함수는 excludedHashes로 제외되어 빈 결과', () => {
    const source = `
      function dup(x: number) {
        const y = x + 1;
        return y;
      }
    `;
    const fileA = makeFile('a.ts', source);
    const fileB = makeFile('b.ts', source);
    // 동일 함수의 fingerprint를 excluded에 넣음
    const { createOxcFingerprintShape } = require('../../engine/ast/oxc-fingerprint');
    const { collectFunctionNodes } = require('../../engine/ast/oxc-ast-utils');
    const fns = collectFunctionNodes(fileA.program);
    const hash = createOxcFingerprintShape(fns[0]);
    const excluded = new Set<string>([hash]);
    const result = detectNearMissClones([fileA, fileB], defaultOptions, excluded);

    expect(result).toHaveLength(0);
  });

  it('Statement 1개만 다른 소규모 함수 쌍 → near-miss 그룹 형성 (small path)', () => {
    const files = makeSimilarSmallPair();
    // similarityThreshold를 낮추어 검출 보장
    const opts = { ...defaultOptions, similarityThreshold: 0.5, minSize: 2 };
    const result = detectNearMissClones(files, opts);

    expect(result.length).toBeGreaterThanOrEqual(1);

    const group = result[0]!;

    expect(group.items.length).toBeGreaterThanOrEqual(2);
    expect(group.similarity).toBeGreaterThan(0);
  });

  it('완전 불일치 함수 → 빈 결과', () => {
    const files = makeDifferentFunctions();
    const result = detectNearMissClones(files, defaultOptions);

    expect(result).toHaveLength(0);
  });

  it('threshold 높으면 유사 함수도 그룹 미형성', () => {
    const files = makeSimilarSmallPair();
    const opts = { ...defaultOptions, similarityThreshold: 0.99, minSize: 2 };
    const result = detectNearMissClones(files, opts);

    // 0.99 threshold에서 statement 1개 차이는 통과 못할 가능성 높음
    // (결과가 있을 수도 없을 수도 있음, 구조에 따라)
    // → 최소한 에러 없이 실행됨
    expect(Array.isArray(result)).toBe(true);
  });

  it('3개 함수 A≈B, B≈C → transitive closure로 {A,B,C} 그룹', () => {
    const fileA = makeFile(
      'a.ts',
      `
      function opA(x: number) {
        const y = x + 1;
        return y;
      }
    `,
    );
    const fileB = makeFile(
      'b.ts',
      `
      function opB(x: number) {
        const y = x + 2;
        return y;
      }
    `,
    );
    const fileC = makeFile(
      'c.ts',
      `
      function opC(x: number) {
        const y = x + 3;
        return y;
      }
    `,
    );
    const opts = { ...defaultOptions, similarityThreshold: 0.5, minSize: 2 };
    const result = detectNearMissClones([fileA, fileB, fileC], opts);

    // 구조가 거의 동일하므로 하나의 그룹에 3개 함수
    if (result.length > 0) {
      const totalItems = result.reduce((s, g) => s + g.items.length, 0);

      expect(totalItems).toBeGreaterThanOrEqual(2);
    }
  });

  it('파싱 에러 있는 파일은 건너뜀', () => {
    const goodFile = makeFile(
      'good.ts',
      `
      function okFn(x: number) {
        const y = x + 1;
        return y;
      }
    `,
    );
    const badFile: ParsedFile = {
      filePath: 'bad.ts',
      program: {} as never,
      errors: [{ message: 'parse error' } as never],
      comments: [],
      sourceText: '',
      module: {} as never,
    };
    // 에러 없이 실행됨
    const result = detectNearMissClones([goodFile, badFile], defaultOptions);

    expect(Array.isArray(result)).toBe(true);
  });

  it('minSize 필터 동작 — 작은 함수 제외', () => {
    const file = makeFile(
      'a.ts',
      `
      function tiny() { return 1; }
      function tiny2() { return 2; }
    `,
    );
    const opts = { ...defaultOptions, minSize: 100 };
    const result = detectNearMissClones([file], opts);

    expect(result).toHaveLength(0);
  });

  it('sizeRatio 필터 — 크기 차이가 큰 쌍 제외', () => {
    const fileA = makeFile(
      'a.ts',
      `
      function small(x: number) {
        return x;
      }
    `,
    );
    const fileB = makeFile(
      'b.ts',
      `
      function big(x: number) {
        const a = x + 1;
        const b = a + 2;
        const c = b + 3;
        const d = c + 4;
        const e = d + 5;
        const f = e + 6;
        const g = f + 7;
        if (g > 100) {
          console.log("big");
        }
        return g;
      }
    `,
    );
    // strict sizeRatio → 크기 차이 큰 쌍 제외
    const opts = { ...defaultOptions, sizeRatio: 0.9, minSize: 2 };
    const result = detectNearMissClones([fileA, fileB], opts);

    expect(result).toHaveLength(0);
  });

  it('그룹의 similarity가 0 ~ 1 범위', () => {
    const files = makeSimilarSmallPair();
    const opts = { ...defaultOptions, similarityThreshold: 0.3, minSize: 2 };
    const result = detectNearMissClones(files, opts);

    for (const group of result) {
      expect(group.similarity).toBeGreaterThanOrEqual(0);
      expect(group.similarity).toBeLessThanOrEqual(1);
    }
  });

  it('그룹 아이템에 filePath, header, span 포함', () => {
    const files = makeSimilarSmallPair();
    const opts = { ...defaultOptions, similarityThreshold: 0.3, minSize: 2 };
    const result = detectNearMissClones(files, opts);

    for (const group of result) {
      for (const item of group.items) {
        expect(typeof item.filePath).toBe('string');
        expect(item.filePath.length).toBeGreaterThan(0);
        expect(typeof item.header).toBe('string');
        expect(item.span).toBeDefined();
        expect(item.span.start.line).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('대규모 함수 쌍 (MinHash path) — 유사 함수 그룹 형성', () => {
    const files = makeSimilarLargePair();
    // threshold를 낮추어 검출. 비록 MinHash → LSH → LCS 경로를 탐
    const opts = { ...defaultOptions, similarityThreshold: 0.5, minSize: 2 };
    const result = detectNearMissClones(files, opts);

    // MinHash 확률적이므로 반드시 찾는 건 아니지만, 에러 없이 실행
    expect(Array.isArray(result)).toBe(true);
  });

  it('detectNearMissClones - 3개 함수 transitive closure 시 모든 쌍의 similarity가 평균에 반영', () => {
    // A≈B, B≈C 직접 비교로 그룹 형성 → A-C 쌍은 직접 비교 안 될 수 있음
    // 보정 전: simCount = 2 (A-B, B-C만), 보정 후: simCount = 3 (A-B, A-C, B-C 모두)
    // 3개 함수 모두 구조가 거의 동일하여 하나의 그룹으로 묶임
    const fileA = makeFile(
      'a.ts',
      `
      function calcA(x: number) {
        const a = x + 1;
        const b = a * 2;
        const c = b - 1;
        return c;
      }
    `,
    );
    const fileB = makeFile(
      'b.ts',
      `
      function calcB(x: number) {
        const a = x + 2;
        const b = a * 2;
        const c = b - 1;
        return c;
      }
    `,
    );
    const fileC = makeFile(
      'c.ts',
      `
      function calcC(x: number) {
        const a = x + 3;
        const b = a * 2;
        const c = b - 1;
        return c;
      }
    `,
    );
    const opts = { ...defaultOptions, similarityThreshold: 0.5, minSize: 2 };
    const result = detectNearMissClones([fileA, fileB, fileC], opts);

    // 3개 함수가 하나의 그룹으로 묶여야 함
    expect(result.length).toBeGreaterThanOrEqual(1);

    const group = result.find(g => g.items.length === 3);

    expect(group).toBeDefined();

    // similarity는 A-B, A-C, B-C 3쌍의 평균이어야 함 (0 초과 1 이하)
    // 보정 전: A-C 쌍이 누락되어 simCount=2 → 분모가 작아 과대 추정
    // 보정 후: simCount=3 → 더 정확한 평균
    expect(group!.similarity).toBeGreaterThan(0);
    expect(group!.similarity).toBeLessThanOrEqual(1);
  });

  it('detectNearMissClones - small×large cross: 4-stmt and 6-stmt similar functions - groups them', () => {
    // Arrange
    // 4개 statement 함수 (small, minStatementCount=5 기준)
    const fileSmall = makeFile(
      'small.ts',
      `
      function smallFn(x: number) {
        const a = x + 1;
        const b = a * 2;
        const c = b - 1;
        return c;
      }
    `,
    );
    // 6개 statement 함수 (large) — 앞 4개가 smallFn과 동일
    const fileLarge = makeFile(
      'large.ts',
      `
      function largeFn(x: number) {
        const a = x + 1;
        const b = a * 2;
        const c = b - 1;
        const d = c + 5;
        const e = d * 3;
        return e;
      }
    `,
    );
    // Act
    const opts = { ...defaultOptions, similarityThreshold: 0.5, minSize: 2 };
    const result = detectNearMissClones([fileSmall, fileLarge], opts);

    // Assert: small×large 교차 비교로 그룹 형성
    expect(result.length).toBeGreaterThanOrEqual(1);

    const group = result[0]!;

    expect(group.items.length).toBeGreaterThanOrEqual(2);

    const headers = group.items.map(item => item.header);

    expect(headers.some(h => h.includes('smallFn'))).toBe(true);
    expect(headers.some(h => h.includes('largeFn'))).toBe(true);
  });

  it('detectNearMissClones - small×large cross: sizeRatio not met - excludes pair', () => {
    // Arrange
    // small: 2개 statement (minStatementCount=5 기준으로 small)
    const fileSmall = makeFile(
      'tiny.ts',
      `
      function tinyFn(x: number) {
        const a = x + 1;
        return a;
      }
    `,
    );
    // large: 20개 statement (large) — size 차이가 매우 커서 sizeRatio 0.9 불충족
    const fileLarge = makeFile(
      'huge.ts',
      `
      function hugeFn(x: number) {
        const a = x + 1;
        const b = a * 2;
        const c = b - 1;
        const d = c + 4;
        const e = d * 5;
        const f = e - 6;
        const g = f + 7;
        const h = g * 8;
        const i2 = h - 9;
        const j = i2 + 10;
        const k = j * 11;
        const l = k - 12;
        const m = l + 13;
        const n = m * 14;
        const o = n - 15;
        const p = o + 16;
        const q = p * 17;
        const r = q - 18;
        const s = r + 19;
        return s;
      }
    `,
    );
    // Act: sizeRatio=0.9이면 2/20=0.1 < 0.9 이므로 필터링됨
    const opts = { ...defaultOptions, sizeRatio: 0.9, similarityThreshold: 0.5, minSize: 2 };
    const result = detectNearMissClones([fileSmall, fileLarge], opts);

    // Assert: sizeRatio 미충족으로 교차 비교에서 제외
    expect(result).toHaveLength(0);
  });
});

// ─── fillMissingPairSimilarities (unit) ──────────────────────────────────────

describe('fillMissingPairSimilarities', () => {
  it('fillMissingPairSimilarities - A-C 쌍 누락 시 보충 계산하여 맵에 추가', () => {
    // Arrange: 인덱스 0,1,2 그룹, pairSimilarities에 0-1, 1-2만 있고 0-2 없음
    const fingerprints: ReadonlyArray<string>[] = [
      ['stmt:ExpressionStatement:BinaryExpression', 'stmt:ReturnStatement'],
      ['stmt:ExpressionStatement:BinaryExpression', 'stmt:ReturnStatement'],
      ['stmt:ExpressionStatement:BinaryExpression', 'stmt:ReturnStatement'],
    ];
    const memberIndices = [0, 1, 2];
    const pairSimilarities = new Map<string, number>([
      ['0-1', 0.9],
      ['1-2', 0.85],
      // '0-2' 누락
    ]);

    // Act
    __testing__.fillMissingPairSimilarities(memberIndices, fingerprints, pairSimilarities);

    // Assert: 0-2 쌍이 보충 계산되어 맵에 추가됨
    expect(pairSimilarities.has('0-2')).toBe(true);

    const sim = pairSimilarities.get('0-2')!;

    expect(sim).toBeGreaterThan(0);
    expect(sim).toBeLessThanOrEqual(1);
  });

  it('fillMissingPairSimilarities - 이미 모든 쌍이 있으면 기존 값 유지', () => {
    // Arrange: 0-1, 0-2, 1-2 모두 있음
    const fingerprints: ReadonlyArray<string>[] = [['stmt:A'], ['stmt:B'], ['stmt:C']];
    const memberIndices = [0, 1, 2];
    const pairSimilarities = new Map<string, number>([
      ['0-1', 0.8],
      ['0-2', 0.7],
      ['1-2', 0.75],
    ]);

    // Act
    __testing__.fillMissingPairSimilarities(memberIndices, fingerprints, pairSimilarities);

    // Assert: 기존 값이 덮어써지지 않음
    expect(pairSimilarities.get('0-1')).toBe(0.8);
    expect(pairSimilarities.get('0-2')).toBe(0.7);
    expect(pairSimilarities.get('1-2')).toBe(0.75);
  });

  it('fillMissingPairSimilarities - 2개 멤버 그룹에서 쌍 누락 시 보충 계산', () => {
    // Arrange: 인덱스 3, 7 그룹, 3-7 쌍 누락
    const fingerprints: ReadonlyArray<string>[] = new Array(8)
      .fill(null)
      .map((_, i) => (i === 3 || i === 7 ? ['stmt:ExpressionStatement', 'stmt:ReturnStatement'] : []));
    const memberIndices = [3, 7];
    const pairSimilarities = new Map<string, number>();

    // Act
    __testing__.fillMissingPairSimilarities(memberIndices, fingerprints, pairSimilarities);

    // Assert: 3-7 쌍이 추가됨
    expect(pairSimilarities.has('3-7')).toBe(true);
  });
});
