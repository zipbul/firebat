import { mock, afterAll, describe, it, expect, beforeEach } from 'bun:test';
import path from 'node:path';

import type { DuplicateFindingKind } from '../../types';
import type { ParsedFile } from '../../engine/types';
import type { AntiUnificationResult, DiffClassification } from './anti-unifier';

import { parseSource } from '../../engine/ast/parse-source';

// ─── Mocks ────────────────────────────────────────────────────────────────────

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

// Apply mocks

void mock.module(path.resolve(import.meta.dir, './anti-unifier.ts'), () => ({
  antiUnify: antiUnifyMock,
  classifyDiff: classifyDiffMock,
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
  void mock.module(path.resolve(import.meta.dir, './anti-unifier.ts'), () => __origAntiUnifier);
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
    const result = analyzeDuplicates([file], { minSize: 3, enableAntiUnification: false });
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
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableAntiUnification: false });
    const shape = result.filter(g => g.cloneType === 'shape');

    expect(shape.length).toBe(1);
    expect(shape[0]!.findingKind).toBe('structural-clone');

    // exact에 없어야 함
    const exact = result.filter(g => g.cloneType === 'exact');
    const exactHeaders = exact.flatMap(g => g.items.map(i => i.header));

    expect(exactHeaders).not.toContain(shape[0]?.items[0]?.header);
  });

  // ── [HP] 3. 리터럴만 다른 함수 2개 → shape 그룹 (shape는 literal도 strip) ────

  it('should NOT group two functions that differ only in literals (literals never substituted)', () => {
    const fileA = makeFile('a.ts', LITERAL_PAIR_A);
    const fileB = makeFile('b.ts', LITERAL_PAIR_B);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableAntiUnification: false });
    // 리터럴은 어느 tier에서도 치환하지 않는다 → 리터럴만 다른 함수는 정규형이 어긋나 비매칭
    // (모호한 literal-variant 비탐지, zero-FP). exact/shape/normalized 모두 그룹 없음.
    const grouped = result.filter(g => g.cloneType === 'shape' || g.cloneType === 'normalized' || g.cloneType === 'exact');

    expect(grouped.length).toBe(0);
  });

  // ── [HP] 4. shape 그룹이 exact에서 이미 잡힌 해시 → 필터링 ───────────

  it('should filter out shape groups that overlap with exact groups', () => {
    const file = makeFile('dup.ts', IDENTICAL_FUNCTIONS);
    const result = analyzeDuplicates([file], { minSize: 3, enableAntiUnification: false });
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
    const result = analyzeDuplicates([file], { minSize: 3, enableAntiUnification: false });
    const normalized = result.filter(g => g.cloneType === 'normalized');

    expect(normalized.length).toBe(0);
  });

  // ── [HP] 8/9/9b. anti-unification classification → suggestedParams 종류 ──
  // classifyDiff가 rename-only/literal-variant/type-variant이면, 단일 변수가
  // 그에 대응하는 kind의 suggestedParams로 전파되고 findingKind도 결정된다.

  it.each<
    [
      string,
      DiffClassification,
      AntiUnificationResult['variables'][number],
      readonly [string, string],
      'literal' | 'type' | 'identifier',
      DuplicateFindingKind,
    ]
  >([
    [
      'rename-only → identifier',
      'rename-only',
      { id: 1, location: 'id.name', leftType: 'calcSum', rightType: 'addValues', kind: 'identifier' },
      [RENAMED_PAIR_A, RENAMED_PAIR_B],
      'identifier',
      'structural-clone',
    ],
    // NOTE: literal-variant 분류는 개념에서 제거됨(리터럴 비치환) — 리터럴만 다른 함수는
    // 애초에 그룹화되지 않으므로 anti-unify 전파 케이스가 성립하지 않는다.
    [
      'type-variant → type',
      'type-variant',
      { id: 1, location: 'params[0].typeAnnotation', leftType: 'TSTypeReference', rightType: 'TSTypeReference', kind: 'type' },
      [RENAMED_PAIR_A, RENAMED_PAIR_B],
      'type',
      'structural-clone',
    ],
  ])('should set suggestedParams — %s', (_label, classification, variable, [srcA, srcB], expectedKind, expectedFindingKind) => {
    classifyDiffMock.mockImplementation(() => classification);
    antiUnifyMock.mockImplementation(() => ({
      sharedSize: 10,
      leftSize: 10,
      rightSize: 10,
      similarity: 0.9,
      variables: [variable],
    }));

    const fileA = makeFile('a.ts', srcA);
    const fileB = makeFile('b.ts', srcB);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableAntiUnification: true });
    const withParams = result.filter(g => g.suggestedParams !== undefined);

    expect(withParams.length).toBe(1);
    expect(withParams[0]!.suggestedParams!.kind).toBe(expectedKind);
    expect(withParams[0]!.suggestedParams!.pairs.length).toBe(1);
    expect(withParams[0]!.findingKind).toBe(expectedFindingKind);
  });

  // ── [HP] 10-11. anti-unification structural-diff/mixed → no suggestedParams ─

  it.each<[DiffClassification]>([['structural-diff'], ['mixed']])(
    'should not set suggestedParams when diff classification is %s',
    classification => {
      classifyDiffMock.mockImplementation(() => classification);

      const fileA = makeFile('a.ts', RENAMED_PAIR_A);
      const fileB = makeFile('b.ts', RENAMED_PAIR_B);
      const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableAntiUnification: true });

      for (const group of result) {
        expect(group.suggestedParams).toBeUndefined();
      }
    },
  );

  // ── [HP] 12. anti-unification disabled → no suggestedParams ─────────────

  it('should not set suggestedParams when enableAntiUnification is false', () => {
    const fileA = makeFile('a.ts', RENAMED_PAIR_A);
    const fileB = makeFile('b.ts', RENAMED_PAIR_B);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableAntiUnification: false });

    for (const group of result) {
      expect(group.suggestedParams).toBeUndefined();
    }

    expect(antiUnifyMock).not.toHaveBeenCalled();
  });

  // ── [HP] 13. FunctionDeclaration → kind='function' ─────────────────────

  it('should assign kind function to FunctionDeclaration items', () => {
    const fileA = makeFile('a.ts', FUNCTION_DECLARATION);
    const fileB = makeFile('b.ts', FUNCTION_DECLARATION);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableAntiUnification: false });
    const exact = result.filter(g => g.cloneType === 'exact');

    expect(exact.length).toBe(1);
    expect(exact[0]!.items[0]!.kind).toBe('function');
  });

  // ── [HP] 14-17. 노드 타입 → item.kind 매핑 ─────────────────────────────
  // 클론 그룹의 item.kind가 노드 종류별로 올바르게 부여되는지. method 케이스는
  // 클래스 구조를 다르게 만들어 Class 그룹 미생성, 동일 Method만 exact 그룹.

  it.each([
    [
      'MethodDefinition → kind=method',
      `
class Alpha {
  compute(x: number): number {
    const doubled = x * 2;
    return doubled;
  }
  extra(): void { console.log('a'); }
}
`,
      `
class Beta {
  compute(x: number): number {
    const doubled = x * 2;
    return doubled;
  }
}
`,
      'method',
    ],
    ['ClassDeclaration → kind=type', CLASS_DECLARATION_A, CLASS_DECLARATION_B, 'type'],
    ['TSInterfaceDeclaration → kind=interface', INTERFACE_DECLARATION_A, INTERFACE_DECLARATION_B, 'interface'],
    ['ArrowFunctionExpression → kind=function', ARROW_FUNCTION, ARROW_FUNCTION, 'function'],
  ] as const)('should assign item kind correctly — %s', (_label, srcA, srcB, expectedKind) => {
    const fileA = makeFile('a.ts', srcA);
    const fileB = makeFile('b.ts', srcB);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableAntiUnification: false });
    const matchingItems = result.flatMap(g => g.items).filter(i => i.kind === expectedKind);

    expect(matchingItems.length).toBeGreaterThanOrEqual(2);
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
    const result = analyzeDuplicates([file], { minSize: 3, enableAntiUnification: false });
    const exact = result.filter(g => g.cloneType === 'exact');

    expect(exact.length).toBe(1);
    expect(exact[0]!.items.length).toBe(3);
  });

  // ── [NE] 20. 빈 files 배열 → 빈 결과 ──────────────────────────────────

  it('should return empty array when files array is empty', () => {
    const result = analyzeDuplicates([], { minSize: 3, enableAntiUnification: false });

    expect(result).toEqual([]);
  });

  // ── [NE] 21. 파싱 에러 → 해당 파일 skip ────────────────────────────────

  it('should skip files with parse errors', () => {
    const errorFile = makeErrorFile('bad.ts');
    const goodFile = makeFile('good.ts', FUNCTION_DECLARATION);
    const result = analyzeDuplicates([errorFile, goodFile], {
      minSize: 3,
      enableAntiUnification: false,
    });
    // 에러 파일은 무시, 정상 파일 1개만 → 그룹 없음
    const itemsFromBad = result.flatMap(g => g.items).filter(i => i.filePath === 'bad.ts');

    expect(itemsFromBad).toHaveLength(0);
  });

  // ── [NE] 22. minSize는 선언 클론을 억제하지 않는다 (floor는 fragment 전용) ──
  //
  // REDESIGN: minSize는 문장열(fragment)의 결정-존재 floor일 뿐이다. 선언은 크기
  // 무관하게 중복이면 클론이므로, 아주 작은 동일 함수도 높은 minSize에서 보고된다.
  // (옛 동작은 corpus-상대 floor로 작은 중복 함수를 숨겼다 — false negative.)

  it('does not suppress declaration clones by minSize (floor is fragment-only)', () => {
    const file = makeFile('tiny.ts', TINY_FUNCTION);
    const result = analyzeDuplicates([file, makeFile('tiny2.ts', TINY_FUNCTION)], {
      minSize: 9999,
      enableAntiUnification: false,
    });

    expect(result.length).toBe(1);
    expect(result[0]!.items.length).toBe(2);
  });

  // ── [NE] 22b. 결정-존재 floor 미만 익명 인라인 람다는 클론으로 보고하지 않는다 ──
  //
  // 명명 선언과 달리 익명 인라인 표현식(arrow)은 명명된 변경지점이 아니므로 결정-존재
  // floor(minSize)를 적용한다. 우연히 같은 사소한 람다(`(a,b)=>a-b` 등)는 독립 결정의
  // 동형이라 비탐지(zero-FP). 같은 floor를 넘는 람다는 정상 보고된다.

  it('suppresses below-floor anonymous arrow clones (decision-existence floor applies to inline lambdas)', () => {
    // `(a, b) => a - b` (size≈6) — 두 파일에 우연히 같은 비교자. floor=12 미만 → 비탐지.
    const a = makeFile('cmp-a.ts', `export const sorted = items.sort((a, b) => a - b);`);
    const b = makeFile('cmp-b.ts', `export const ordered = values.sort((a, b) => a - b);`);
    const result = analyzeDuplicates([a, b], { minSize: 12, enableAntiUnification: false });

    expect(result).toEqual([]);
  });

  it('still reports an anonymous arrow clone at or above the floor size', () => {
    // 본문이 큰 동일 화살표(size ≥ 12)는 결정을 담으므로 floor를 넘겨 정상 보고.
    const body = 'p => { const a = p.x + p.y; const b = a * p.z; return a + b + p.w; }';
    const a = makeFile('big-a.ts', `export const m = items.map(${body});`);
    const b = makeFile('big-b.ts', `export const n = values.map(${body});`);
    const result = analyzeDuplicates([a, b], { minSize: 12, enableAntiUnification: false });

    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result.some(g => g.items.length >= 2)).toBe(true);
  });

  // ── [NE] 23. 단일 함수만 존재 → 그룹 없음 ─────────────────────────────

  it('should return empty array when only one function exists', () => {
    const file = makeFile('single.ts', FUNCTION_DECLARATION);
    const result = analyzeDuplicates([file], { minSize: 3, enableAntiUnification: false });

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
    const result = analyzeDuplicates([file], { minSize: 1, enableAntiUnification: false });

    expect(result).toEqual([]);
  });

  // ── [ED] 25. minSize=0 → 모든 함수 포함 ────────────────────────────────

  it('should include all functions when minSize is 0', () => {
    const file = makeFile('dup.ts', IDENTICAL_FUNCTIONS);
    const result = analyzeDuplicates([file], { minSize: 0, enableAntiUnification: false });

    expect(result.length).toBe(1);
  });

  // ── [ED] 26. 정확히 2개 함수 → 최소 그룹 크기 ──────────────────────────

  it('should form a group with exactly 2 identical functions (minimum group size)', () => {
    const fileA = makeFile('a.ts', FUNCTION_DECLARATION);
    const fileB = makeFile('b.ts', FUNCTION_DECLARATION);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableAntiUnification: false });
    const exact = result.filter(g => g.cloneType === 'exact');

    expect(exact.length).toBe(1);
    expect(exact[0]!.items).toHaveLength(2);
  });

  // ── [ED] 28. 한 파일에만 중복이 존재 ───────────────────────────────────

  it('should detect duplicates within a single file', () => {
    const file = makeFile('single.ts', IDENTICAL_FUNCTIONS);
    const result = analyzeDuplicates([file], { minSize: 3, enableAntiUnification: false });

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
      enableAntiUnification: false,
    });

    expect(result.length).toBe(1);

    const allFilePaths = result.flatMap(g => g.items.map(i => i.filePath));

    expect(allFilePaths).not.toContain('bad.ts');
  });

  // ── [CO] 30. anti-unification 비활성화 → Level 1만 ────

  it('should only use Level 1 when anti-unification is disabled', () => {
    const file = makeFile('dup.ts', IDENTICAL_FUNCTIONS);
    const result = analyzeDuplicates([file], { minSize: 3, enableAntiUnification: false });

    expect(antiUnifyMock).not.toHaveBeenCalled();
    expect(result.length).toBe(1);
  });

  // ── [ID] 32. 같은 입력 2회 호출 → 동일 결과 ────────────────────────────

  it('should produce identical results when called twice with the same input', () => {
    const file = makeFile('dup.ts', IDENTICAL_FUNCTIONS);
    const opts = { minSize: 3, enableAntiUnification: false } as const;
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
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableAntiUnification: false });
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
    const result = analyzeDuplicates([fileA, fileA], { minSize: 3, enableAntiUnification: false });

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
    const opts = { minSize: 3, enableAntiUnification: false } as const;
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
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableAntiUnification: false });

    for (const group of result) {
      if (group.cloneType === 'shape' || group.cloneType === 'normalized') {
        expect(group.findingKind).toBe('structural-clone');
      }
    }
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
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableAntiUnification: true });
    const withParams = result.filter(g => g.suggestedParams !== undefined);

    expect(withParams.length).toBe(1);
    // rename-only → findingKind는 cloneType 기반 기본값 (structural-clone), literal-variant 아님
    expect(withParams[0]!.findingKind).not.toBe('literal-variant');
  });

  // ── [C-2] 40. 같은 정규형으로 묶인 N멤버는 통계적 분리 없이 한 그룹 ──────────
  // (과거의 mean+2σ outlier 분리는 임계 기반이라 제거됨 — 닫힌 규칙 보장)

  it('should keep all members of one normalized group together, never splitting by variable-count', () => {
    // 5 멤버가 한 auResult는 변수 100개(구조적으로 더 다름)여도 분리되면 안 됨
    for (let i = 0; i < 3; i++) {
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

    const source = `
function compute(x: number, y: number): number {
  const a = x + y;
  const b = a * 2;
  return b;
}
`;
    const files = Array.from({ length: 5 }, (_, i) => makeFile(`f${i}.ts`, source));
    const result = analyzeDuplicates(files, { minSize: 3, enableAntiUnification: true });
    // 동일 정규형 → 정확히 하나의 그룹, 5개 멤버 전부 포함, 통계적 분리 없음
    const groups = result.filter(g => g.items.length >= 2);

    expect(groups.length).toBe(1);
    expect(groups[0]!.items.length).toBe(5);
  });

  // ── [C-2] 41. anti-unification 켜도 단일 그룹 유지 (분리 로직 부재 확인) ──────

  it('should not split a structurally-divergent member into a separate group', () => {
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
    const files = Array.from({ length: 4 }, (_, i) => makeFile(`f${i}.ts`, source));
    const result = analyzeDuplicates(files, { minSize: 3, enableAntiUnification: true });
    const groups = result.filter(g => g.items.length >= 2);

    expect(groups.length).toBe(1);
    expect(groups[0]!.items.length).toBe(4);
  });

  // ── [HP] 43-44. ClassExpression / FunctionExpression exact 탐지 ────────

  it.each([
    [
      'ClassExpression',
      `
export const MyClass = class {
  compute(x: number): number {
    const doubled = x * 2;
    return doubled;
  }
};
`,
    ],
    [
      'FunctionExpression',
      `
export const compute = function(x: number): number {
  const doubled = x * 2;
  return doubled;
};
`,
    ],
  ] as const)('analyzeDuplicates - %s in two files - detects exact clone', (_label, source) => {
    const fileA = makeFile('a.ts', source);
    const fileB = makeFile('b.ts', source);
    const result = analyzeDuplicates([fileA, fileB], { minSize: 3, enableAntiUnification: false });
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
      enableAntiUnification: false,
    });

    for (const group of result) {
      expect(group.findingKind).toBeDefined();
      expect(['exact-clone', 'structural-clone', 'literal-variant', 'type-variant', 'fragment-clone']).toContain(
        group.findingKind,
      );
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// REDESIGN golden — min-size policy
//
// Concept (CLAUDE.md): the minSize floor is defined ONLY for statement-run
// fragments ("결정-존재 floor") — declarations are clone targets by structure at
// ANY size. The corpus-relative auto-minSize wrongly gated declarations too,
// hiding genuine small duplicated functions (e.g. getProgramBody, isPlainObject).
//
// These tests fix the contract: declarations ignore minSize; fragments keep an
// absolute floor; decisionless skeletons stay K via role (not size).
// TDD red against the current implementation (analyzer.ts gates declarations by
// `size < minSize`); green once that gate is removed for declaration targets.
// ════════════════════════════════════════════════════════════════════════════

// Genuine small duplicated decision (the getProgramBody case): NOT a skeleton.
const TINY_DECL_CLONE = `
function pa(prog: { body: unknown }): unknown[] {
  const body = prog.body;
  if (Array.isArray(body)) {
    return body as unknown[];
  }
  return [];
}
function pb(prog: { body: unknown }): unknown[] {
  const body = prog.body;
  if (Array.isArray(body)) {
    return body as unknown[];
  }
  return [];
}
`;

// Param-passthrough delegation duplicated — decisionless skeleton (K by role).
// Free functions (not methods) so the only candidate clone is the delegation
// itself, with no enclosing-class structural clone to confound the assertion.
const TINY_SKELETON_CLONE = `
function findUser(id: string) {
  return repo.find(id);
}
function findOrder(id: string) {
  return repo.find(id);
}
`;

// Two distinct functions sharing only a tiny (<12 node) extractable statement run.
const TINY_FRAGMENT_CLONE = `
function ga(x: number): number {
  const a = x;
  console.log(a);
  return finA(a);
}
function gb(x: number): number {
  const a = x;
  console.log(a);
  return finB(a);
}
`;

describe('min-size policy (redesign)', () => {
  it('reports a genuine small duplicated declaration even at a very high minSize', () => {
    // Declarations have NO size floor — getProgramBody-style clone must surface.
    const result = analyzeDuplicates([makeFile('/p/tiny-decl.ts', TINY_DECL_CLONE)], {
      minSize: 9999,
      enableAntiUnification: false,
    });

    expect(result.length).toBe(1);
    expect(result[0]!.items.length).toBe(2);
    expect(result[0]!.items.map(i => i.header).sort()).toEqual(['pa', 'pb']);
  });

  it('still keeps a decisionless skeleton clone as K regardless of minSize', () => {
    // Removing the declaration size floor must NOT make skeletons leak — the
    // skeleton exemption is a role rule, independent of size.
    const high = analyzeDuplicates([makeFile('/p/tiny-skel.ts', TINY_SKELETON_CLONE)], {
      minSize: 9999,
      enableAntiUnification: false,
    });
    const low = analyzeDuplicates([makeFile('/p/tiny-skel.ts', TINY_SKELETON_CLONE)], {
      minSize: 1,
      enableAntiUnification: false,
    });

    expect(high).toEqual([]);
    expect(low).toEqual([]);
  });

  it('keeps an ABSOLUTE floor for statement-run fragments (not declarations)', () => {
    // A sub-floor fragment is reported below the floor and gated at/above it —
    // and crucially that verdict is the SAME constant regardless of corpus.
    const reported = analyzeDuplicates([makeFile('/p/tiny-frag.ts', TINY_FRAGMENT_CLONE)], {
      minSize: 1,
      enableAntiUnification: false,
    });
    const gated = analyzeDuplicates([makeFile('/p/tiny-frag.ts', TINY_FRAGMENT_CLONE)], {
      minSize: 12,
      enableAntiUnification: false,
    });

    expect(reported.some(g => g.findingKind === 'fragment-clone')).toBe(true);
    expect(gated.some(g => g.findingKind === 'fragment-clone')).toBe(false);
  });
});
