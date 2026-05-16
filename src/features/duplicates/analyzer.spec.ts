import { mock, afterAll, describe, it, expect, beforeEach } from 'bun:test';
import path from 'node:path';

import type { ParsedFile } from '../../engine/types';
import type { DuplicateGroup } from '../../types';
import type { AntiUnificationResult, DiffClassification } from './anti-unifier';
import type { NearMissCloneGroup } from './near-miss-detector';

import { parseSource } from '../../engine/ast/parse-source';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const detectNearMissClonesMock = mock((_files: unknown, _opts: unknown, _excluded?: unknown): NearMissCloneGroup[] => []);
const antiUnifyMock = mock(
  (_left: unknown, _right: unknown): AntiUnificationResult => ({
    sharedSize: 10,
    leftSize: 10,
    rightSize: 10,
    similarity: 1.0,
    variables: [],
  }),
);
const classifyDiffMock = mock((_result: unknown): DiffClassification => 'rename-only');
// Save originals
const __origAntiUnifier = {
  ...require(path.resolve(import.meta.dir, './anti-unifier.ts')),
};
const __origNearMissDetector = {
  ...require(path.resolve(import.meta.dir, './near-miss-detector.ts')),
};

// Apply mocks

mock.module(path.resolve(import.meta.dir, './anti-unifier.ts'), () => ({
  antiUnify: antiUnifyMock,
  classifyDiff: classifyDiffMock,
}));

mock.module(path.resolve(import.meta.dir, './near-miss-detector.ts'), () => ({
  detectNearMissClones: detectNearMissClonesMock,
}));

// Import SUT after mocks

const { analyzeDuplicates, createEmptyDuplicates } = await import('./analyzer');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeFile = (fileName: string, source: string): ParsedFile => parseSource(fileName, source);

// 정확히 동일한 함수 2개가 있는 파일
const IDENTICAL_FUNCTIONS = `
function add(a: number, b: number): number {
  return a + b;
}

function add(a: number, b: number): number {
  return a + b;
}
`;
// 이름/리터럴만 다른 함수 쌍 (shape 동일, exact 다름)
const RENAMED_PAIR_A = `
function calcSum(x: number, y: number): number {
  const result = x + y;
  return result;
}
`;
const RENAMED_PAIR_B = `
function addValues(a: number, b: number): number {
  const result = a + b;
  return result;
}
`;
// 리터럴만 다른 함수 (shape 동일)
const LITERAL_PAIR_A = `
function getTimeout(): number {
  const base = 1000;
  return base * 2;
}
`;
const LITERAL_PAIR_B = `
function getTimeout(): number {
  const base = 5000;
  return base * 3;
}
`;
// 작은 함수 (minSize 이하)
const TINY_FUNCTION = `
function id(x: number) { return x; }
`;
// 다양한 노드 타입
const FUNCTION_DECLARATION = `
function process(x: number): number {
  const doubled = x * 2;
  return doubled;
}
`;
const CLASS_DECLARATION_A = `
class Handler {
  handle(x: number): number {
    const y = x + 1;
    const z = y * 2;
    return z;
  }
  run(): void {}
}
`;
const CLASS_DECLARATION_B = `
class Handler {
  handle(x: number): number {
    const y = x + 1;
    const z = y * 2;
    return z;
  }
  run(): void {}
}
`;
const INTERFACE_DECLARATION_A = `
interface Config {
  readonly host: string;
  readonly port: number;
  readonly timeout: number;
}
`;
const INTERFACE_DECLARATION_B = `
interface Config {
  readonly host: string;
  readonly port: number;
  readonly timeout: number;
}
`;
const ARROW_FUNCTION = `
const process = (x: number): number => {
  const doubled = x * 2;
  return doubled;
};
`;

// 파싱 에러 파일
const makeErrorFile = (fileName: string): ParsedFile => ({
  filePath: fileName,
  program: {} as ParsedFile['program'],
  errors: [{ message: 'Syntax error' } as unknown as ParsedFile['errors'][0]],
  comments: [],
  sourceText: 'invalid {{{ code',
  module: {} as never,
});

// ─── Teardown ─────────────────────────────────────────────────────────────────

afterAll(() => {
  mock.module(path.resolve(import.meta.dir, './anti-unifier.ts'), () => __origAntiUnifier);
  mock.module(path.resolve(import.meta.dir, './near-miss-detector.ts'), () => __origNearMissDetector);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('createEmptyDuplicates', () => {
  it('should return an empty ReadonlyArray when called', () => {
    const result = createEmptyDuplicates();

    expect(result).toEqual([]);
    expect(result).toHaveLength(0);
  });
});

describe('analyzeDuplicates', () => {
  beforeEach(() => {
    detectNearMissClonesMock.mockReset();
    detectNearMissClonesMock.mockImplementation(() => []);
    antiUnifyMock.mockReset();
    antiUnifyMock.mockImplementation(() => ({
      sharedSize: 10,
      leftSize: 10,
      rightSize: 10,
      similarity: 1.0,
      variables: [],
    }));
    classifyDiffMock.mockReset();
    classifyDiffMock.mockImplementation(() => 'structural-diff');
  });

  // ── [HP] 1. 동일 함수 2개 → exact 그룹 반환 ───────────────────────────

  it('should return a exact group when two identical functions exist in one file', () => {
    const file = makeFile('dup.ts', IDENTICAL_FUNCTIONS);
    const result = analyzeDuplicates([file], { minSize: 3, enableNearMiss: false, enableAntiUnification: false });
    const exact = result.filter(g => g.cloneType === 'exact');

    expect(exact.length).toBe(1);
    expect(exact[0]!.items.length).toBeGreaterThanOrEqual(2);
    expect(exact[0]!.items[0]!.filePath).toBe('dup.ts');
    expect(exact[0]!.findingKind).toBe('exact-clone');
  });

  // ── [HP] 2. 이름만 다른 함수 2개 → shape 그룹 ──────────────────

  it('should return a shape group when two functions differ only in names', () => {
    const fileA = makeFile('a.ts', RENAMED_PAIR_A);
    const fileB = makeFile('b.ts', RENAMED_PAIR_B);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableNearMiss: false, enableAntiUnification: false });
    const shape = result.filter(g => g.cloneType === 'shape');

    expect(shape.length).toBe(1);
    expect(shape[0]!.findingKind).toBe('structural-clone');

    // exact에 없어야 함
    const exact = result.filter(g => g.cloneType === 'exact');
    const exactHeaders = exact.flatMap(g => g.items.map(i => i.header));

    expect(exactHeaders).not.toContain(shape[0]?.items[0]?.header);
  });

  // ── [HP] 3. 리터럴만 다른 함수 2개 → shape 그룹 (shape는 literal도 strip) ────

  it('should return a shape group when two functions differ only in literals', () => {
    const fileA = makeFile('a.ts', LITERAL_PAIR_A);
    const fileB = makeFile('b.ts', LITERAL_PAIR_B);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableNearMiss: false, enableAntiUnification: false });
    // shape fingerprint strips both identifiers and literals → same shape
    const shape = result.filter(g => g.cloneType === 'shape');

    expect(shape.length).toBe(1);
  });

  // ── [HP] 4. shape 그룹이 exact에서 이미 잡힌 해시 → 필터링 ───────────

  it('should filter out shape groups that overlap with exact groups', () => {
    const file = makeFile('dup.ts', IDENTICAL_FUNCTIONS);
    const result = analyzeDuplicates([file], { minSize: 3, enableNearMiss: false, enableAntiUnification: false });
    // 정확히 동일한 함수 2개 → exact에 잡힘 → shape에 중복 보고 없음
    const exact = result.filter(g => g.cloneType === 'exact');
    const shape = result.filter(g => g.cloneType === 'shape');

    expect(exact.length).toBe(1);

    // shape에 같은 함수가 잡히면 안 됨
    for (const g2 of shape) {
      for (const item of g2.items) {
        const inExact = exact.some(g1 => g1.items.some(i1 => i1.header === item.header && i1.filePath === item.filePath));

        // 같은 header+filePath가 exact에도 있으면 shape에 중복 안 됨을 확인
        // (shape hash가 같은 경우 필터링됨)
        if (inExact) {
          // shape group의 header가 exact group에도 있다면, 이건 필터링이 안 된 경우
          // 하지만 실제로는 shape hash가 같으므로 필터링되어야 함
        }
      }
    }

    // exact에 중복이 잡혔으므로 shape에서 같은 shape hash 그룹은 제거됨
    // 이 assertion은 shape가 exact과 중복 그룹을 갖지 않는지 확인
    expect(shape.length).toBe(0);
  });

  // ── [HP] 5. normalized 그룹이 exact/2 해시와 겹치면 필터링 ────────────────

  it('should filter out normalized groups that overlap with exact/2 groups', () => {
    // 동일 함수 → exact AND shape AND normalized 모두 해시 동일
    // → normalized는 필터링되어야 함
    const file = makeFile('dup.ts', IDENTICAL_FUNCTIONS);
    const result = analyzeDuplicates([file], { minSize: 3, enableNearMiss: false, enableAntiUnification: false });
    const normalized = result.filter(g => g.cloneType === 'normalized');

    expect(normalized.length).toBe(0);
  });

  // ── [HP] 6. near-miss 활성화 → near-miss 그룹 포함 ─────────────────────

  it('should include near-miss groups when enableNearMiss is true', () => {
    const file = makeFile('a.ts', RENAMED_PAIR_A);
    const nmGroupItems = [
      {
        node: {} as unknown,
        kind: 'function' as const,
        header: 'nmFunc',
        filePath: 'a.ts',
        span: { start: { line: 1, column: 0 }, end: { line: 5, column: 1 } },
        size: 10,
        statementFingerprints: [],
      },
      {
        node: {} as unknown,
        kind: 'function' as const,
        header: 'nmFunc2',
        filePath: 'b.ts',
        span: { start: { line: 1, column: 0 }, end: { line: 5, column: 1 } },
        size: 10,
        statementFingerprints: [],
      },
    ];

    detectNearMissClonesMock.mockImplementation(() => [{ items: nmGroupItems, similarity: 0.85 }]);

    const result = analyzeDuplicates([file], { minSize: 3, enableNearMiss: true, enableAntiUnification: false });
    const nmGroups = result.filter(g => g.items.some(i => i.header === 'nmFunc' || i.header === 'nmFunc2'));

    expect(nmGroups.length).toBe(1);
    expect(nmGroups[0]!.cloneType).toBe('near-miss');
    expect(nmGroups[0]!.findingKind).toBe('near-miss-clone');
    expect(detectNearMissClonesMock).toHaveBeenCalledTimes(1);
  });

  // ── [HP] 7. near-miss 비활성화 → near-miss 없음 ────────────────────────

  it('should not call detectNearMissClones when enableNearMiss is false', () => {
    const file = makeFile('a.ts', RENAMED_PAIR_A);

    analyzeDuplicates([file], { minSize: 3, enableNearMiss: false, enableAntiUnification: false });

    expect(detectNearMissClonesMock).not.toHaveBeenCalled();
  });

  // ── [HP] 8. anti-unification rename-only → suggestedParams identifier ──

  it('should set suggestedParams with kind identifier when all diffs are rename-only', () => {
    classifyDiffMock.mockImplementation(() => 'rename-only');
    antiUnifyMock.mockImplementation(() => ({
      sharedSize: 10,
      leftSize: 10,
      rightSize: 10,
      similarity: 0.9,
      variables: [{ id: 1, location: 'id.name', leftType: 'calcSum', rightType: 'addValues', kind: 'identifier' }],
    }));

    const fileA = makeFile('a.ts', RENAMED_PAIR_A);
    const fileB = makeFile('b.ts', RENAMED_PAIR_B);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableNearMiss: false, enableAntiUnification: true });
    const withParams = result.filter(g => g.suggestedParams !== undefined);

    expect(withParams.length).toBe(1);
    expect(withParams[0]!.suggestedParams!.kind).toBe('identifier');
    expect(withParams[0]!.suggestedParams!.pairs.length).toBe(1);
  });

  // ── [HP] 9. anti-unification literal-variant → suggestedParams literal ──

  it('should set suggestedParams with kind literal when all diffs are literal-variant', () => {
    classifyDiffMock.mockImplementation(() => 'literal-variant');
    antiUnifyMock.mockImplementation(() => ({
      sharedSize: 10,
      leftSize: 10,
      rightSize: 10,
      similarity: 0.9,
      variables: [{ id: 1, location: 'body.value', leftType: '1000', rightType: '5000', kind: 'literal' }],
    }));

    const fileA = makeFile('a.ts', LITERAL_PAIR_A);
    const fileB = makeFile('b.ts', LITERAL_PAIR_B);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableNearMiss: false, enableAntiUnification: true });
    const withParams = result.filter(g => g.suggestedParams !== undefined);

    expect(withParams.length).toBe(1);
    expect(withParams[0]!.suggestedParams!.kind).toBe('literal');
    expect(withParams[0]!.findingKind).toBe('literal-variant');
  });

  // ── [HP] 9b. anti-unification type-variant → suggestedParams type ────────

  it('should set suggestedParams with kind type when all diffs are type-variant', () => {
    classifyDiffMock.mockImplementation(() => 'type-variant');
    antiUnifyMock.mockImplementation(() => ({
      sharedSize: 10,
      leftSize: 10,
      rightSize: 10,
      similarity: 0.9,
      variables: [
        { id: 1, location: 'params[0].typeAnnotation', leftType: 'TSTypeReference', rightType: 'TSTypeReference', kind: 'type' },
      ],
    }));

    const fileA = makeFile('a.ts', RENAMED_PAIR_A);
    const fileB = makeFile('b.ts', RENAMED_PAIR_B);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableNearMiss: false, enableAntiUnification: true });
    const withParams = result.filter(g => g.suggestedParams !== undefined);

    expect(withParams.length).toBe(1);
    expect(withParams[0]!.suggestedParams!.kind).toBe('type');
  });

  // ── [HP] 10. anti-unification structural-diff → no suggestedParams ──────

  it('should not set suggestedParams when diff classification is structural-diff', () => {
    classifyDiffMock.mockImplementation(() => 'structural-diff');

    const fileA = makeFile('a.ts', RENAMED_PAIR_A);
    const fileB = makeFile('b.ts', RENAMED_PAIR_B);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableNearMiss: false, enableAntiUnification: true });

    for (const group of result) {
      expect(group.suggestedParams).toBeUndefined();
    }
  });

  // ── [HP] 11. anti-unification mixed → no suggestedParams ───────────────

  it('should not set suggestedParams when diff classification is mixed', () => {
    classifyDiffMock.mockImplementation(() => 'mixed');

    const fileA = makeFile('a.ts', RENAMED_PAIR_A);
    const fileB = makeFile('b.ts', RENAMED_PAIR_B);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableNearMiss: false, enableAntiUnification: true });

    for (const group of result) {
      expect(group.suggestedParams).toBeUndefined();
    }
  });

  // ── [HP] 12. anti-unification disabled → no suggestedParams ─────────────

  it('should not set suggestedParams when enableAntiUnification is false', () => {
    const fileA = makeFile('a.ts', RENAMED_PAIR_A);
    const fileB = makeFile('b.ts', RENAMED_PAIR_B);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableNearMiss: false, enableAntiUnification: false });

    for (const group of result) {
      expect(group.suggestedParams).toBeUndefined();
    }

    expect(antiUnifyMock).not.toHaveBeenCalled();
  });

  // ── [HP] 13. FunctionDeclaration → kind='function' ─────────────────────

  it('should assign kind function to FunctionDeclaration items', () => {
    const fileA = makeFile('a.ts', FUNCTION_DECLARATION);
    const fileB = makeFile('b.ts', FUNCTION_DECLARATION);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableNearMiss: false, enableAntiUnification: false });
    const exact = result.filter(g => g.cloneType === 'exact');

    expect(exact.length).toBe(1);
    expect(exact[0]!.items[0]!.kind).toBe('function');
  });

  // ── [HP] 14. MethodDefinition → kind='method' ──────────────────────────

  it('should assign kind method to MethodDefinition items', () => {
    // 클래스 구조를 다르게 → Class 그룹 미생성, 동일 Method만 exact 그룹
    const srcA = `
class Alpha {
  compute(x: number): number {
    const doubled = x * 2;
    return doubled;
  }
  extra(): void { console.log('a'); }
}
`;
    const srcB = `
class Beta {
  compute(x: number): number {
    const doubled = x * 2;
    return doubled;
  }
}
`;
    const fileA = makeFile('a.ts', srcA);
    const fileB = makeFile('b.ts', srcB);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableNearMiss: false, enableAntiUnification: false });
    const methodItems = result.flatMap(g => g.items).filter(i => i.kind === 'method');

    expect(methodItems.length).toBeGreaterThanOrEqual(2);
  });

  // ── [HP] 15. ClassDeclaration → kind='type' ────────────────────────────

  it('should assign kind type to ClassDeclaration items', () => {
    const fileA = makeFile('a.ts', CLASS_DECLARATION_A);
    const fileB = makeFile('b.ts', CLASS_DECLARATION_B);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableNearMiss: false, enableAntiUnification: false });
    const classItems = result.flatMap(g => g.items).filter(i => i.kind === 'type');

    expect(classItems.length).toBeGreaterThanOrEqual(2);
  });

  // ── [HP] 16. TSInterfaceDeclaration → kind='interface' ─────────────────

  it('should assign kind interface to TSInterfaceDeclaration items', () => {
    const fileA = makeFile('a.ts', INTERFACE_DECLARATION_A);
    const fileB = makeFile('b.ts', INTERFACE_DECLARATION_B);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableNearMiss: false, enableAntiUnification: false });
    const ifItems = result.flatMap(g => g.items).filter(i => i.kind === 'interface');

    expect(ifItems.length).toBeGreaterThanOrEqual(2);
  });

  // ── [HP] 17. fallback node type → kind='node' (N/A — 모든 target 타입이 매핑됨) ──

  it('should default to function kind for ArrowFunctionExpression', () => {
    const fileA = makeFile('a.ts', ARROW_FUNCTION);
    const fileB = makeFile('b.ts', ARROW_FUNCTION);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableNearMiss: false, enableAntiUnification: false });
    const arrowItems = result.flatMap(g => g.items).filter(i => i.kind === 'function');

    expect(arrowItems.length).toBeGreaterThanOrEqual(2);
  });

  // ── [HP] 18. excludedHashes로 Level 1 결과가 near-miss에서 제외 ─────────

  it('should pass excludedHashes from Level 1 to near-miss detector', () => {
    const file = makeFile('dup.ts', IDENTICAL_FUNCTIONS);

    detectNearMissClonesMock.mockImplementation(() => []);

    analyzeDuplicates([file], { minSize: 3, enableNearMiss: true, enableAntiUnification: false });

    expect(detectNearMissClonesMock).toHaveBeenCalledTimes(1);

    const callArgs = detectNearMissClonesMock.mock.calls[0]!;
    const excludedHashes = callArgs[2] as Set<string>;

    expect(excludedHashes).toBeInstanceOf(Set);
    expect(excludedHashes.size).toBeGreaterThan(0);
  });

  // ── [HP] 19. 3개 동일 함수 → exact 그룹 items 3개 ─────────────────────

  it('should group three identical functions into a single exact group', () => {
    const tripleSource = `
      function add(a: number, b: number): number {
        return a + b;
      }
      function add(a: number, b: number): number {
        return a + b;
      }
      function add(a: number, b: number): number {
        return a + b;
      }
    `;
    const file = makeFile('triple.ts', tripleSource);
    const result = analyzeDuplicates([file], { minSize: 3, enableNearMiss: false, enableAntiUnification: false });
    const exact = result.filter(g => g.cloneType === 'exact');

    expect(exact.length).toBe(1);
    expect(exact[0]!.items.length).toBe(3);
  });

  // ── [NE] 20. 빈 files 배열 → 빈 결과 ──────────────────────────────────

  it('should return empty array when files array is empty', () => {
    const result = analyzeDuplicates([], { minSize: 3, enableNearMiss: false, enableAntiUnification: false });

    expect(result).toEqual([]);
  });

  // ── [NE] 21. 파싱 에러 → 해당 파일 skip ────────────────────────────────

  it('should skip files with parse errors', () => {
    const errorFile = makeErrorFile('bad.ts');
    const goodFile = makeFile('good.ts', FUNCTION_DECLARATION);
    const result = analyzeDuplicates([errorFile, goodFile], {
      minSize: 3,
      enableNearMiss: false,
      enableAntiUnification: false,
    });
    // 에러 파일은 무시, 정상 파일 1개만 → 그룹 없음
    const itemsFromBad = result.flatMap(g => g.items).filter(i => i.filePath === 'bad.ts');

    expect(itemsFromBad).toHaveLength(0);
  });

  // ── [NE] 22. 모든 함수 minSize 미만 → 빈 결과 ──────────────────────────

  it('should return empty array when all functions are below minSize', () => {
    const file = makeFile('tiny.ts', TINY_FUNCTION);
    const result = analyzeDuplicates([file, makeFile('tiny2.ts', TINY_FUNCTION)], {
      minSize: 9999,
      enableNearMiss: false,
      enableAntiUnification: false,
    });

    expect(result).toEqual([]);
  });

  // ── [NE] 23. 단일 함수만 존재 → 그룹 없음 ─────────────────────────────

  it('should return empty array when only one function exists', () => {
    const file = makeFile('single.ts', FUNCTION_DECLARATION);
    const result = analyzeDuplicates([file], { minSize: 3, enableNearMiss: false, enableAntiUnification: false });

    expect(result).toEqual([]);
  });

  // ── [NE] 24. clone target 아닌 노드만 → 빈 결과 ────────────────────────

  it('should return empty array when file contains no clone target nodes', () => {
    const source = `
      const x = 1;
      const y = 2;
      export { x, y };
    `;
    const file = makeFile('vars.ts', source);
    const result = analyzeDuplicates([file], { minSize: 1, enableNearMiss: false, enableAntiUnification: false });

    expect(result).toEqual([]);
  });

  // ── [ED] 25. minSize=0 → 모든 함수 포함 ────────────────────────────────

  it('should include all functions when minSize is 0', () => {
    const file = makeFile('dup.ts', IDENTICAL_FUNCTIONS);
    const result = analyzeDuplicates([file], { minSize: 0, enableNearMiss: false, enableAntiUnification: false });

    expect(result.length).toBe(1);
  });

  // ── [ED] 26. 정확히 2개 함수 → 최소 그룹 크기 ──────────────────────────

  it('should form a group with exactly 2 identical functions (minimum group size)', () => {
    const fileA = makeFile('a.ts', FUNCTION_DECLARATION);
    const fileB = makeFile('b.ts', FUNCTION_DECLARATION);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableNearMiss: false, enableAntiUnification: false });
    const exact = result.filter(g => g.cloneType === 'exact');

    expect(exact.length).toBe(1);
    expect(exact[0]!.items).toHaveLength(2);
  });

  // ── [ED] 27. nearMissSimilarityThreshold 커스텀 값 전달 확인 ────────────

  it('should pass custom nearMissSimilarityThreshold to near-miss detector', () => {
    const file = makeFile('a.ts', FUNCTION_DECLARATION);

    detectNearMissClonesMock.mockImplementation(() => []);

    analyzeDuplicates([file], {
      minSize: 3,
      enableNearMiss: true,
      enableAntiUnification: false,
      nearMissSimilarityThreshold: 0.9,
    });

    expect(detectNearMissClonesMock).toHaveBeenCalledTimes(1);

    const opts = detectNearMissClonesMock.mock.calls[0]![1] as Record<string, unknown>;

    expect(opts.similarityThreshold).toBe(0.9);
  });

  // ── [ED] 28. 한 파일에만 중복이 존재 ───────────────────────────────────

  it('should detect duplicates within a single file', () => {
    const file = makeFile('single.ts', IDENTICAL_FUNCTIONS);
    const result = analyzeDuplicates([file], { minSize: 3, enableNearMiss: false, enableAntiUnification: false });

    expect(result.length).toBe(1);
    expect(result[0]!.items.every(i => i.filePath === 'single.ts')).toBe(true);
  });

  // ── [CO] 29. 에러 파일 + 정상 파일 혼합 ────────────────────────────────

  it('should process valid files and skip error files when mixed', () => {
    const errorFile = makeErrorFile('bad.ts');
    const fileA = makeFile('a.ts', FUNCTION_DECLARATION);
    const fileB = makeFile('b.ts', FUNCTION_DECLARATION);
    const result = analyzeDuplicates([errorFile, fileA, fileB], {
      minSize: 3,
      enableNearMiss: false,
      enableAntiUnification: false,
    });

    expect(result.length).toBe(1);

    const allFilePaths = result.flatMap(g => g.items.map(i => i.filePath));

    expect(allFilePaths).not.toContain('bad.ts');
  });

  // ── [CO] 30. near-miss + anti-unification 모두 비활성화 → Level 1만 ────

  it('should only use Level 1 when both near-miss and anti-unification are disabled', () => {
    const file = makeFile('dup.ts', IDENTICAL_FUNCTIONS);
    const result = analyzeDuplicates([file], { minSize: 3, enableNearMiss: false, enableAntiUnification: false });

    expect(detectNearMissClonesMock).not.toHaveBeenCalled();
    expect(antiUnifyMock).not.toHaveBeenCalled();
    expect(result.length).toBe(1);
  });

  // ── [CO] 31. exact excludedHashes가 near-miss에서 정확 제외 ────────────

  it('should exclude exact shape hashes from near-miss detection', () => {
    const fileA = makeFile('a.ts', FUNCTION_DECLARATION);
    const fileB = makeFile('b.ts', FUNCTION_DECLARATION);

    detectNearMissClonesMock.mockImplementation(() => []);

    analyzeDuplicates([fileA, fileB], { minSize: 3, enableNearMiss: true, enableAntiUnification: false });

    expect(detectNearMissClonesMock).toHaveBeenCalledTimes(1);

    const excludedHashes = detectNearMissClonesMock.mock.calls[0]![2] as Set<string>;

    // Level 1에서 exact 그룹이 생겼으므로 excludedHashes에 해시가 포함
    expect(excludedHashes.size).toBeGreaterThan(0);
  });

  // ── [ID] 32. 같은 입력 2회 호출 → 동일 결과 ────────────────────────────

  it('should produce identical results when called twice with the same input', () => {
    const file = makeFile('dup.ts', IDENTICAL_FUNCTIONS);
    const opts = { minSize: 3, enableNearMiss: false, enableAntiUnification: false } as const;
    const result1 = analyzeDuplicates([file], opts);
    const result2 = analyzeDuplicates([file], opts);

    expect(result1).toEqual(result2);
  });

  // ── [H-2] 38. ClassDeclaration + MethodDefinition 이중 보고 필터링 ──────

  it('analyzeDuplicates - ClassDeclaration 안에 MethodDefinition 포함 시 - 내포된 Method 그룹 필터링', () => {
    // CLASS_DECLARATION_A/B: 각 파일에 Class + Method 노드 존재
    // Class 그룹이 Method 그룹을 내포하므로 Method 그룹이 제거되어야 함
    const fileA = makeFile('a.ts', CLASS_DECLARATION_A);
    const fileB = makeFile('b.ts', CLASS_DECLARATION_B);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableNearMiss: false, enableAntiUnification: false });
    // type 그룹(ClassDeclaration)이 존재해야 함
    const classGroups = result.filter(g => g.items.some(i => i.kind === 'type'));

    expect(classGroups.length).toBe(1);

    // method 그룹이 있다면, class 그룹에 내포된 method 그룹은 없어야 함
    // 즉, class 그룹의 span 안에 완전히 포함되는 method 그룹은 결과에서 제거됨
    for (const classGroup of classGroups) {
      for (const methodGroup of result) {
        if (methodGroup === classGroup) {
          continue;
        }

        if (!methodGroup.items.every(mi => mi.kind === 'method')) {
          continue;
        }

        // method 그룹의 모든 아이템이 대응하는 class 그룹 아이템의 span에 완전히 포함되면
        // filterSubsumedGroups가 제거했어야 함
        const allSubsumed = methodGroup.items.every(methodItem =>
          classGroup.items.some(
            classItem =>
              methodItem.filePath === classItem.filePath &&
              (methodItem.span.start.line > classItem.span.start.line ||
                (methodItem.span.start.line === classItem.span.start.line &&
                  methodItem.span.start.column >= classItem.span.start.column)) &&
              (methodItem.span.end.line < classItem.span.end.line ||
                (methodItem.span.end.line === classItem.span.end.line &&
                  methodItem.span.end.column <= classItem.span.end.column)),
          ),
        );

        expect(allSubsumed).toBe(false);
      }
    }
  });

  // ── [NEW-5] 39. 동일 filePath 중복 입력 시 자기 자신 그룹 미생성 ─────────

  it('analyzeDuplicates - 동일 filePath 파일 중복 입력 시 - 자기 자신 그룹 미생성', () => {
    // 단일 함수가 있는 파일을 2번 넣으면 중복 그룹이 생성되면 안 됨
    const fileA = makeFile('a.ts', FUNCTION_DECLARATION);
    const result = analyzeDuplicates([fileA, fileA], { minSize: 3, enableNearMiss: false, enableAntiUnification: false });

    // 같은 filePath의 동일 span 아이템이 한 그룹에 2개 있으면 안 됨
    for (const group of result) {
      const seenKeys = new Set<string>();

      for (const item of group.items) {
        const key = `${item.filePath}:${item.span.start.line}:${item.span.start.column}`;

        expect(seenKeys.has(key)).toBe(false);
        seenKeys.add(key);
      }
    }
  });

  // ── [OR] 33. 파일 순서 변경 → 그룹 내용 동일 ───────────────────────────

  it('should produce same groups regardless of file order', () => {
    const fileA = makeFile('a.ts', FUNCTION_DECLARATION);
    const fileB = makeFile('b.ts', FUNCTION_DECLARATION);
    const opts = { minSize: 3, enableNearMiss: false, enableAntiUnification: false } as const;
    const result1 = analyzeDuplicates([fileA, fileB], opts);
    const result2 = analyzeDuplicates([fileB, fileA], opts);

    // 그룹 수 동일
    expect(result1.length).toBe(result2.length);

    // 아이템 집합 동일 (순서 무관)
    const headers1 = result1.flatMap(g => g.items.map(i => `${i.filePath}:${i.header}`)).sort();
    const headers2 = result2.flatMap(g => g.items.map(i => `${i.filePath}:${i.header}`)).sort();

    expect(headers1).toEqual(headers2);
  });

  // ── [HP] 34. findingKind: normalized → structural-clone ──────────

  it('should assign findingKind structural-clone to normalized groups', () => {
    // normalized은 이름+리터럴 정규화 후 같은 함수
    // 직접적으로 normalized만 생성하기는 어려우므로
    // shape에서 structural-clone 확인
    const fileA = makeFile('a.ts', LITERAL_PAIR_A);
    const fileB = makeFile('b.ts', LITERAL_PAIR_B);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableNearMiss: false, enableAntiUnification: false });

    for (const group of result) {
      if (group.cloneType === 'shape' || group.cloneType === 'normalized') {
        expect(group.findingKind).toBe('structural-clone');
      }
    }
  });

  // ── [HP] 35. findingKind: near-miss 그룹에 similarity 포함 ─────────────

  it('should include similarity in near-miss groups', () => {
    const file = makeFile('a.ts', RENAMED_PAIR_A);
    const nmGroupItems = [
      {
        node: {} as unknown,
        kind: 'function' as const,
        header: 'nmFunc',
        filePath: 'a.ts',
        span: { start: { line: 1, column: 0 }, end: { line: 5, column: 1 } },
        size: 10,
        statementFingerprints: [],
      },
      {
        node: {} as unknown,
        kind: 'function' as const,
        header: 'nmFunc2',
        filePath: 'b.ts',
        span: { start: { line: 1, column: 0 }, end: { line: 5, column: 1 } },
        size: 10,
        statementFingerprints: [],
      },
    ];

    detectNearMissClonesMock.mockImplementation(() => [{ items: nmGroupItems, similarity: 0.82 }]);

    const result = analyzeDuplicates([file], { minSize: 3, enableNearMiss: true, enableAntiUnification: false });
    const nmGroups = result.filter(g => g.cloneType === 'near-miss');

    expect(nmGroups.length).toBe(1);
    expect(nmGroups[0]!.similarity).toBe(0.82);
    expect(nmGroups[0]!.findingKind).toBe('near-miss-clone');
  });

  // ── [HP] 36. findingKind: rename-only에서 literal-variant override 안 됨 ─

  it('should not override findingKind to literal-variant when diff is rename-only', () => {
    classifyDiffMock.mockImplementation(() => 'rename-only');
    antiUnifyMock.mockImplementation(() => ({
      sharedSize: 10,
      leftSize: 10,
      rightSize: 10,
      similarity: 0.9,
      variables: [{ id: 1, location: 'id.name', leftType: 'calcSum', rightType: 'addValues', kind: 'identifier' }],
    }));

    const fileA = makeFile('a.ts', RENAMED_PAIR_A);
    const fileB = makeFile('b.ts', RENAMED_PAIR_B);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableNearMiss: false, enableAntiUnification: true });
    const withParams = result.filter(g => g.suggestedParams !== undefined);

    expect(withParams.length).toBe(1);
    // rename-only → findingKind는 cloneType 기반 기본값 (structural-clone), literal-variant 아님
    expect(withParams[0]!.findingKind).not.toBe('literal-variant');
  });

  // ── [C-2] 40. 7멤버 1 outlier → core group + pattern-outlier group ──────────
  // 수학적 근거: n=6 auResults에서 (n-1)개가 0, 1개가 v일 때
  // threshold = v*(1+2*sqrt(5))/6 ≈ v*0.912 < v → outlier 탐지 가능

  it('applyAntiUnification - 7 members with 1 structural outlier - creates pattern-outlier group', () => {
    // Arrange: 5 auResults가 각 1개 변수, 1개 auResult가 100개 변수(outlier)
    // mean = (5*1 + 100)/6 = 17.5
    // variance = (5*(1-17.5)^2 + (100-17.5)^2) / 6 = (5*272.25 + 6806.25) / 6 = 8167.5/6 = 1361.25
    // stdDev = 36.9
    // threshold = 17.5 + 2*36.9 = 91.3
    // 100 > 91.3 → outlier 탐지!
    for (let i = 0; i < 5; i++) {
      antiUnifyMock.mockImplementationOnce(() => ({
        sharedSize: 10,
        leftSize: 10,
        rightSize: 10,
        similarity: 0.95,
        variables: [{ id: 1, location: `loc${i}`, leftType: 'x', rightType: 'y', kind: 'identifier' as const }],
      }));
      classifyDiffMock.mockImplementationOnce(() => 'rename-only');
    }

    antiUnifyMock.mockImplementationOnce(() => ({
      sharedSize: 5,
      leftSize: 10,
      rightSize: 50,
      similarity: 0.2,
      variables: Array.from({ length: 100 }, (_, j) => ({
        id: j + 1,
        location: `s${j}`,
        leftType: 'A',
        rightType: 'B',
        kind: 'structural' as const,
      })),
    }));
    classifyDiffMock.mockImplementationOnce(() => 'structural-diff');

    // 동일 함수 7개 파일 (exact 그룹 생성, rep 제외 6개 auResults)
    const source = `
function compute(x: number, y: number): number {
  const a = x + y;
  const b = a * 2;
  return b;
}
`;
    const files = Array.from({ length: 7 }, (_, i) => makeFile(`f${i}.ts`, source));
    // Act
    const result = analyzeDuplicates(files, {
      minSize: 3,
      enableNearMiss: false,
      enableAntiUnification: true,
    });
    // Assert: outlier 그룹이 생성되어야 함
    const outlierGroups = result.filter(g => g.findingKind === 'pattern-outlier');

    expect(outlierGroups.length).toBe(1);
    expect(outlierGroups[0]!.items.length).toBe(1);
  });

  // ── [C-2] 41. 2멤버 → outlier 판별 안함 ────────────────────────────────

  it('applyAntiUnification - 2 members - no outlier detection applied', () => {
    // Arrange: 2개 함수 (auResults 1개 → items.length < 3 → outlier 로직 미적용)
    antiUnifyMock.mockImplementation(() => ({
      sharedSize: 5,
      leftSize: 10,
      rightSize: 20,
      similarity: 0.4,
      variables: Array.from({ length: 30 }, (_, i) => ({
        id: i + 1,
        location: `loc${i}`,
        leftType: 'A',
        rightType: 'B',
        kind: 'structural' as const,
      })),
    }));
    classifyDiffMock.mockImplementation(() => 'structural-diff');

    const source = `
function compute(x: number, y: number): number {
  const a = x + y;
  const b = a * 2;
  return b;
}
`;
    const fileA = makeFile('a.ts', source);
    const fileB = makeFile('b.ts', source);
    // Act
    const result = analyzeDuplicates([fileA, fileB], {
      minSize: 3,
      enableNearMiss: false,
      enableAntiUnification: true,
    });
    // Assert: pattern-outlier 그룹이 생성되지 않아야 함 (2멤버는 outlier 미적용)
    const outlierGroups = result.filter(g => g.findingKind === 'pattern-outlier');

    expect(outlierGroups.length).toBe(0);
  });

  // ── [C-2] 42. 3멤버 모두 유사 → outlier 없음 ───────────────────────────

  it('applyAntiUnification - 3 members all similar - no outlier group created', () => {
    // Arrange: 3 items (1 rep + 2 auResults), 모두 rename-only (변수 수 비슷)
    antiUnifyMock.mockImplementationOnce(() => ({
      sharedSize: 10,
      leftSize: 10,
      rightSize: 10,
      similarity: 1.0,
      variables: [{ id: 1, location: 'a', leftType: 'x', rightType: 'y', kind: 'identifier' as const }],
    }));
    antiUnifyMock.mockImplementationOnce(() => ({
      sharedSize: 10,
      leftSize: 10,
      rightSize: 10,
      similarity: 0.99,
      variables: [{ id: 1, location: 'b', leftType: 'p', rightType: 'q', kind: 'identifier' as const }],
    }));
    classifyDiffMock.mockImplementation(() => 'rename-only');

    const source = `
function compute(x: number, y: number): number {
  const a = x + y;
  const b = a * 2;
  return b;
}
`;
    const fileA = makeFile('a.ts', source);
    const fileB = makeFile('b.ts', source);
    const fileC = makeFile('c.ts', source);
    // Act
    const result = analyzeDuplicates([fileA, fileB, fileC], {
      minSize: 3,
      enableNearMiss: false,
      enableAntiUnification: true,
    });
    // Assert: pattern-outlier 그룹 없음, 단일 그룹만 존재
    const outlierGroups = result.filter(g => g.findingKind === 'pattern-outlier');

    expect(outlierGroups.length).toBe(0);
  });

  // ── [HP] 43. ClassExpression exact 탐지 ───────────────────────────────

  it('analyzeDuplicates - ClassExpression in two files - detects exact clone', () => {
    const source = `
export const MyClass = class {
  compute(x: number): number {
    const doubled = x * 2;
    return doubled;
  }
};
`;
    const fileA = makeFile('a.ts', source);
    const fileB = makeFile('b.ts', source);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableNearMiss: false, enableAntiUnification: false });
    const exact = result.filter(g => g.cloneType === 'exact');

    expect(exact.length).toBe(1);
  });

  // ── [HP] 44. FunctionExpression exact 탐지 ────────────────────────────

  it('analyzeDuplicates - FunctionExpression in two files - detects exact clone', () => {
    const source = `
export const compute = function(x: number): number {
  const doubled = x * 2;
  return doubled;
};
`;
    const fileA = makeFile('a.ts', source);
    const fileB = makeFile('b.ts', source);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableNearMiss: false, enableAntiUnification: false });
    const exact = result.filter(g => g.cloneType === 'exact');

    expect(exact.length).toBe(1);
  });

  // ── [HP] 37. 모든 그룹에 findingKind 존재 확인 ─────────────────────────

  it('should assign findingKind to every returned group', () => {
    const fileA = makeFile('a.ts', IDENTICAL_FUNCTIONS);
    const fileB = makeFile('b.ts', RENAMED_PAIR_A);
    const fileC = makeFile('c.ts', RENAMED_PAIR_B);
    const result = analyzeDuplicates([fileA, fileB, fileC], {
      minSize: 3,
      enableNearMiss: false,
      enableAntiUnification: false,
    });

    for (const group of result) {
      expect(group.findingKind).toBeDefined();
      expect([
        'exact-clone',
        'structural-clone',
        'near-miss-clone',
        'literal-variant',
        'type-variant',
        'pattern-outlier',
      ]).toContain(group.findingKind);
    }
  });
});
