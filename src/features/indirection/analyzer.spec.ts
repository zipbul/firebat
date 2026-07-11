import type { Gildash, CodeRelation, FullSymbol, SymbolSearchResult } from '@zipbul/gildash';

import { GildashError } from '@zipbul/gildash';
import { describe, expect, it } from 'bun:test';

import type { ParsedFile } from '../../engine/types';

import { parseProgramAs as createProgram } from '../../../test/integration/shared/test-kit';
import { parseSource } from '../../engine/ast/parse-source';
import { analyzeIndirection } from './analyzer';

/* ------------------------------------------------------------------ */
/*  Mock gildash factory                                               */
/* ------------------------------------------------------------------ */

interface MockGildashOverrides {
  searchRelations?: (q: unknown) => CodeRelation[];
  searchSymbols?: (q: unknown) => SymbolSearchResult[];
  isTypeAssignableTo?: (src: string, srcFile: string, dst: string, dstFile: string) => boolean | null;
  getFullSymbol?: (name: string, filePath: string) => FullSymbol | null;
}

const createMockGildash = (overrides: MockGildashOverrides = {}): Gildash => {
  return {
    searchRelations: overrides.searchRelations ?? (() => []),
    searchSymbols: overrides.searchSymbols ?? (() => []),
    isTypeAssignableTo: overrides.isTypeAssignableTo ?? (() => null),
    getFullSymbol: overrides.getFullSymbol ?? (() => null),
  } as unknown as Gildash;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const findKinds = (findings: Awaited<ReturnType<typeof analyzeIndirection>>, kind: string) => {
  return findings.filter(finding => finding.kind === kind);
};

/** Assert exactly one finding of `kind`, with the given `header`. */
const expectSingleKindHeader = (findings: Awaited<ReturnType<typeof analyzeIndirection>>, kind: string, header: string): void => {
  const items = findKinds(findings, kind);

  expect(items.length).toBe(1);
  expect(items[0]?.header).toBe(header);
};

interface ReportCase {
  name: string;
  source: string;
  header: string;
}

interface TypeRemapSkipCase {
  name: string;
  filePath: string;
  source: string;
}

interface InterfaceRewrapSkipCase {
  name: string;
  filePath: string;
  source: string;
  gildash: Gildash;
}

/** Shared B-series case shapes (single change-point — avoids duplicate-shape drift). */
interface NameSourceCase {
  name: string;
  source: string;
}

interface WrapperExpectCase {
  name: string;
  source: string;
  expectWrapper: boolean;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('analyzer', () => {
  it('analyzeIndirection - function only forwards call - reports thin-wrapper', async () => {
    // Arrange
    const source = [
      'function target(value) {',
      '  return value + 1;',
      '}',
      'function wrapper(value) {',
      '  return target(value);',
      '}',
    ].join('\n');
    const program = createProgram('/virtual/indirection.ts', source);
    const gildash = createMockGildash();
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');

    expectSingleKindHeader(analysis, 'thin-wrapper', 'wrapper');
  });

  it('analyzeIndirection - exported wrapper with empty gildash export index - skips (AST export status)', async () => {
    // Arrange — gildash returns NO exports (degraded, e.g. deps not installed),
    // but the AST clearly shows `export function`. The export guard must rely on
    // the AST, not the partial gildash index, or it would FP on every export.
    const source = [
      'function core(value) {',
      '  return value;',
      '}',
      'export function exportedFn(value) {',
      '  return core(value);',
      '}',
    ].join('\n');
    const program = createProgram('/virtual/exported.ts', source);
    const gildash = createMockGildash({ searchSymbols: () => [] });
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');

    // Assert — exported single delegation is cross-module → not a thin-wrapper.
    expect(findKinds(analysis, 'thin-wrapper')).toHaveLength(0);
  });

  it('analyzeIndirection - self-recursive wrapper - skips (no layer to inline)', async () => {
    // Arrange
    const source = ['const boom = () => boom();', 'boom();'].join('\n');
    const program = createProgram('/virtual/self-recursive.ts', source);
    const gildash = createMockGildash();
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');

    // Assert — a wrapper that forwards to itself is not inlinable indirection.
    expect(findKinds(analysis, 'thin-wrapper')).toHaveLength(0);
  });

  it('analyzeIndirection - overloaded and non-overloaded coexist - only non-overloaded flagged', async () => {
    // Arrange — file has both overloaded greet and non-overloaded wrapper
    const source = [
      'function greet(name: string): string;',
      'function greet(name: string, age: number): string;',
      'function greet(name: string, age?: number): string {',
      '  return formatGreeting(name, age);',
      '}',
      'function wrapper(value) {',
      '  return target(value);',
      '}',
    ].join('\n');
    const program = createProgram('/virtual/mixed.ts', source);
    const gildash = createMockGildash({
      searchSymbols: () =>
        [
          {
            name: 'greet',
            kind: 'function',
            filePath: 'mixed.ts',
            isExported: false,
            span: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
            id: 1,
            signature: 'params:1|async:0',
            fingerprint: null,
          },
          {
            name: 'greet',
            kind: 'function',
            filePath: 'mixed.ts',
            isExported: false,
            span: { start: { line: 2, column: 0 }, end: { line: 2, column: 0 } },
            id: 2,
            signature: 'params:2|async:0',
            fingerprint: null,
          },
          {
            name: 'greet',
            kind: 'function',
            filePath: 'mixed.ts',
            isExported: false,
            span: { start: { line: 3, column: 0 }, end: { line: 5, column: 0 } },
            id: 3,
            signature: 'params:2|async:0',
            fingerprint: null,
          },
          {
            name: 'wrapper',
            kind: 'function',
            filePath: 'mixed.ts',
            isExported: false,
            span: { start: { line: 6, column: 0 }, end: { line: 8, column: 0 } },
            id: 4,
            signature: 'params:1|async:0',
            fingerprint: null,
          },
        ] as unknown as SymbolSearchResult[],
    });
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');

    expectSingleKindHeader(analysis, 'thin-wrapper', 'wrapper');
  });

  it('analyzeIndirection - overloaded function with pass-through - skips wrapper', async () => {
    // Arrange — overloaded functions provide type narrowing, not simple indirection
    const source = [
      'function greet(name: string): string;',
      'function greet(name: string, age: number): string;',
      'function greet(name: string, age?: number): string {',
      '  return formatGreeting(name, age);',
      '}',
    ].join('\n');
    const program = createProgram('/virtual/overloaded.ts', source);
    // Mock: searchSymbols returns 3 rows for 'greet' (2 overloads + 1 impl)
    const gildash = createMockGildash({
      searchSymbols: () =>
        [
          {
            name: 'greet',
            kind: 'function',
            filePath: 'overloaded.ts',
            isExported: false,
            span: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
            id: 1,
            signature: 'params:1|async:0',
            fingerprint: null,
          },
          {
            name: 'greet',
            kind: 'function',
            filePath: 'overloaded.ts',
            isExported: false,
            span: { start: { line: 2, column: 0 }, end: { line: 2, column: 0 } },
            id: 2,
            signature: 'params:2|async:0',
            fingerprint: null,
          },
          {
            name: 'greet',
            kind: 'function',
            filePath: 'overloaded.ts',
            isExported: false,
            span: { start: { line: 3, column: 0 }, end: { line: 5, column: 0 } },
            id: 3,
            signature: 'params:2|async:0',
            fingerprint: null,
          },
        ] as unknown as SymbolSearchResult[],
    });
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const thinWrappers = findKinds(analysis, 'thin-wrapper');

    // Assert — overloaded function should NOT be flagged as thin-wrapper
    expect(thinWrappers.length).toBe(0);
  });

  it('analyzeIndirection - overloaded method with memberName - skips wrapper', async () => {
    // Arrange — method overload: sym.name = "MyClass.greet", sym.memberName = "greet"
    const source = [
      'class MyClass {',
      '  greet(name: string): string;',
      '  greet(name: string, age: number): string;',
      '  greet(name: string, age?: number): string {',
      '    return formatGreeting(name, age);',
      '  }',
      '}',
    ].join('\n');
    const program = createProgram('/virtual/method-overload.ts', source);
    const gildash = createMockGildash({
      searchSymbols: () =>
        [
          {
            name: 'MyClass.greet',
            memberName: 'greet',
            kind: 'method',
            filePath: 'method-overload.ts',
            isExported: false,
            span: { start: { line: 2, column: 2 }, end: { line: 2, column: 30 } },
            id: 1,
            signature: 'params:1|async:0',
            fingerprint: null,
          },
          {
            name: 'MyClass.greet',
            memberName: 'greet',
            kind: 'method',
            filePath: 'method-overload.ts',
            isExported: false,
            span: { start: { line: 3, column: 2 }, end: { line: 3, column: 38 } },
            id: 2,
            signature: 'params:2|async:0',
            fingerprint: null,
          },
          {
            name: 'MyClass.greet',
            memberName: 'greet',
            kind: 'method',
            filePath: 'method-overload.ts',
            isExported: false,
            span: { start: { line: 4, column: 2 }, end: { line: 6, column: 3 } },
            id: 3,
            signature: 'params:2|async:0',
            fingerprint: null,
          },
        ] as unknown as SymbolSearchResult[],
    });
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const thinWrappers = findKinds(analysis, 'thin-wrapper');

    // Assert — overloaded method should NOT be flagged as thin-wrapper
    expect(thinWrappers.length).toBe(0);
  });

  it('analyzeIndirection - function and method with same unqualified name - no false overload collision', async () => {
    // Arrange — top-level function "greet" and method "MyClass.greet" coexist
    // They should NOT be counted together as overloads
    const source = [
      'function greet(name) { return format(name); }',
      'class MyClass {',
      '  greet(name) { return format(name); }',
      '}',
    ].join('\n');
    const program = createProgram('/virtual/collision.ts', source);
    const gildash = createMockGildash({
      searchSymbols: () =>
        [
          {
            name: 'greet',
            memberName: null,
            kind: 'function',
            filePath: 'collision.ts',
            isExported: false,
            span: { start: { line: 1, column: 0 }, end: { line: 1, column: 40 } },
            id: 1,
            signature: 'params:1|async:0',
            fingerprint: null,
          },
          {
            name: 'MyClass.greet',
            memberName: 'greet',
            kind: 'method',
            filePath: 'collision.ts',
            isExported: false,
            span: { start: { line: 3, column: 2 }, end: { line: 3, column: 40 } },
            id: 2,
            signature: 'params:1|async:0',
            fingerprint: null,
          },
        ] as unknown as SymbolSearchResult[],
    });
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const thinWrappers = findKinds(analysis, 'thin-wrapper');

    // Assert — neither is overloaded; the free function `greet` is a thin-wrapper,
    // but the class method `greet` is K (instance aliasing — ② not closed on AST).
    expect(thinWrappers.length).toBe(1);
    expect(thinWrappers[0]?.header).toBe('greet');
  });

  it('analyzeIndirection - arrow callback to .map - not flagged as thin-wrapper (arity-protective)', async () => {
    // Arrange — `(x) => target(x)` is NOT equivalent to `target` when used as
    // `.map` callback because .map passes (item, index, array). Inlining changes semantics.
    const source = [
      'function target(value: any) { return value + 1; }',
      'function caller(items: any[]) { return items.map(x => target(x)); }',
    ].join('\n');
    const program = createProgram('/virtual/arity-map.ts', source);
    const gildash = createMockGildash();
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const thinWrappers = findKinds(analysis, 'thin-wrapper');

    // Assert — the arrow callback itself should NOT be a thin-wrapper finding.
    // (The named function `caller` is not a wrapper either since it does .map(...).)
    expect(thinWrappers.length).toBe(0);
  });

  it('analyzeIndirection - arrow callback to .forEach/.filter/.then - not flagged as thin-wrapper', async () => {
    // Arrange — multiple high-order method callbacks
    const source = [
      'declare const items: any[];',
      'declare const promise: Promise<any>;',
      'function process(x: any) { return x; }',
      'function run() {',
      '  items.forEach(x => process(x));',
      '  items.filter(x => process(x));',
      '  promise.then(x => process(x));',
      '}',
    ].join('\n');
    const program = createProgram('/virtual/high-order.ts', source);
    const gildash = createMockGildash();
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const thinWrappers = findKinds(analysis, 'thin-wrapper');

    // Assert
    expect(thinWrappers.length).toBe(0);
  });

  it('analyzeIndirection - standalone non-export arrow wrapper - flagged as thin-wrapper', async () => {
    // Arrange — arrow assigned to const, non-export, no identity-position use → W.
    const source = [
      'function target(value: any) { return value + 1; }',
      'const wrapper = (x: any) => target(x);',
      'wrapper(1);',
    ].join('\n');
    const program = createProgram('/virtual/standalone-arrow.ts', source);
    const gildash = createMockGildash();
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');

    // Assert — standalone non-export arrow IS a real thin-wrapper opportunity
    expectSingleKindHeader(analysis, 'thin-wrapper', 'wrapper');
  });

  it('analyzeIndirection - exported standalone arrow wrapper - skipped (cross-module)', async () => {
    // Arrange — exported wrapper: uses may be outside this file, so the
    // reference-identity gate (②) cannot be proven here → K (cross-module).
    const source = ['function target(value: any) { return value + 1; }', 'export const wrapper = (x: any) => target(x);'].join(
      '\n',
    );
    const program = createProgram('/virtual/exported-arrow.ts', source);
    const gildash = createMockGildash({
      searchSymbols: () => [
        {
          name: 'wrapper',
          filePath: '/virtual/exported-arrow.ts',
          kind: 'function',
          isExported: true,
        } as unknown as SymbolSearchResult,
      ],
    });
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const thinWrappers = findKinds(analysis, 'thin-wrapper');

    // Assert
    expect(thinWrappers.length).toBe(0);
  });

  it('analyzeIndirection - wrapper calling target via optional call - skips (spec ①)', async () => {
    // Arrange — `wrapper(x) { return target?.(x); }`: the optional call short-circuits
    // on a nullish callee, an observable decision the bare call lacks → K.
    const source = [
      'function target(value: any) { return value + 1; }',
      'function wrapper(value: any) { return target?.(value); }',
      'wrapper(1);',
    ].join('\n');
    const program = createProgram('/virtual/optional-call.ts', source);
    const gildash = createMockGildash();
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const thinWrappers = findKinds(analysis, 'thin-wrapper');

    // Assert — optional-call wrapper is NOT a thin-wrapper
    expect(thinWrappers.length).toBe(0);
  });

  it('analyzeIndirection - async wrapper with await - skips (error-flow, spec ④)', async () => {
    // Arrange — async/await delegation belongs to error-flow, not indirection.
    const source = [
      'async function target(value: any) { return value + 1; }',
      'async function wrapper(value: any) { return await target(value); }',
      'wrapper(1);',
    ].join('\n');
    const program = createProgram('/virtual/awaited.ts', source);
    const gildash = createMockGildash();
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const thinWrappers = findKinds(analysis, 'thin-wrapper');

    // Assert
    expect(thinWrappers.length).toBe(0);
  });

  it('analyzeIndirection - arguments are transformed - skips wrapper', async () => {
    // Arrange
    const source = [
      'function target(value) {',
      '  return value + 1;',
      '}',
      'function wrapper(value) {',
      '  return target(value + 1);',
      '}',
    ].join('\n');
    const program = createProgram('/virtual/indirection-transform.ts', source);
    const gildash = createMockGildash();
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
    const thinWrappers = findKinds(analysis, 'thin-wrapper');

    // Assert
    expect(thinWrappers.length).toBe(0);
  });

  it('analyzeIndirection - chain depth exceeds max - reports forward-chain', async () => {
    // Arrange
    const source = [
      'function c(value) {',
      '  return value;',
      '}',
      'function b(value) {',
      '  return c(value);',
      '}',
      'function a(value) {',
      '  return b(value);',
      '}',
    ].join('\n');
    const program = createProgram('/virtual/indirection-chain.ts', source);
    const gildash = createMockGildash();
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 1, crossFileMinDepth: 2 }, '/virtual');

    // Assert
    expectSingleKindHeader(analysis, 'forward-chain', 'a');
  });

  it('analyzeIndirection - chain depth within max - skips forward-chain', async () => {
    // Arrange
    const source = [
      'function c(value) {',
      '  return value;',
      '}',
      'function b(value) {',
      '  return c(value);',
      '}',
      'function a(value) {',
      '  return b(value);',
      '}',
    ].join('\n');
    const program = createProgram('/virtual/indirection-depth.ts', source);
    const gildash = createMockGildash();
    // Act
    const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 2, crossFileMinDepth: 2 }, '/virtual');
    const chainFindings = findKinds(analysis, 'forward-chain');

    // Assert
    expect(chainFindings.length).toBe(0);
  });

  // ── 체인 identity: 이름 문자열이 아니라 바인딩(노드)으로 잇는다 ────────────
  //
  // 체인 hop은 callee가 모듈 최상위의 "유일한" 동명 선언으로 해석될 때만 연결한다
  // (스코프 해석으로 닫힌 사실). 중첩 스코프의 동명 함수는 파일 AST로 이름 해석이
  // 안 닫히므로 체인에 불참(보류, K방향). 이름-키 clobber는 선언 순서에 따라 가짜
  // 사이클/깊이를 만들었다 — 결정론 위반.

  describe('chain identity resolves by binding, not by name string', () => {
    // 공용 러너: 파일 하나를 분석해 forward-chain을 `header:depth` 정렬 목록으로 요약한다.
    const chainSummaries = async (filePath: string, source: string): Promise<string[]> => {
      const analysis = await analyzeIndirection(
        createMockGildash(),
        createProgram(filePath, source),
        { maxForwardDepth: 1, crossFileMinDepth: 99 },
        '/virtual',
      );

      return findKinds(analysis, 'forward-chain')
        .map(f => `${f.header}:${f.depth}`)
        .sort();
    };

    // clobber 재현 소스: outer 안의 지역 `b`(→a 위임)가 모듈 `b`(→leaf 위임)와 동명.
    // 진짜 모듈 체인은 top→a→b(→leaf) = depth 3, a→b = depth 2.
    const CLOBBER_SRC = [
      'function leaf(x: number): number { return x * 2; }',
      'const b = (x: number): number => leaf(x);',
      'export function outer(x: number): number {',
      '  const b = (y: number): number => a(y);',
      '  return b(x);',
      '}',
      'const a = (x: number): number => b(x);',
      'export const top = (x: number): number => a(x);',
    ].join('\n');

    it('reports the true module chain despite a same-named nested local (no ghost cycle)', async () => {
      expect(await chainSummaries('/virtual/clobber.ts', CLOBBER_SRC)).toEqual(['a:2', 'top:3']);
    });

    it('is deterministic under declaration reordering (same findings)', async () => {
      // 같은 코드, 선언 순서만 재배열 — 이름-키 clobber는 마지막 승자라 순서에 민감했다.
      const reordered = [
        'export const top = (x: number): number => a(x);',
        'const a = (x: number): number => b(x);',
        'export function outer(x: number): number {',
        '  const b = (y: number): number => a(y);',
        '  return b(x);',
        '}',
        'const b = (x: number): number => leaf(x);',
        'function leaf(x: number): number { return x * 2; }',
      ].join('\n');

      expect(await chainSummaries('/virtual/order.ts', reordered)).toEqual(await chainSummaries('/virtual/clobber.ts', CLOBBER_SRC));
    });

    it('does not link a chain hop through a nested local wrapper (unresolvable scope → hold)', async () => {
      // 모듈 v→leaf, w→leaf 는 전부 depth 1 — forward-chain(>1) 없음. 지역 v(→w)가
      // 모듈 v의 키를 오염시키면 v:2 가짜 체인이 생긴다.
      const source = [
        'function leaf(x: number): number { return x + 1; }',
        'export function host(x: number): number {',
        '  const v = (y: number): number => w(y);',
        '  return v(x);',
        '}',
        'const w = (x: number): number => leaf(x);',
        'const v = (x: number): number => leaf(x);',
      ].join('\n');

      expect(await chainSummaries('/virtual/nested-local.ts', source)).toEqual([]);
    });

    it('rejects a wrapper whose callee is its own parameter (callback slot, not a free function)', async () => {
      // non-export — export 가드가 아니라 파라미터-callee 게이트(③) 자체를 검증한다.
      const source = ['const call = (fn: (g: unknown) => unknown) => fn(fn);', 'export const use = call;'].join('\n');
      const program = createProgram('/virtual/param-callee.ts', source);
      const analysis = await analyzeIndirection(createMockGildash(), program, { maxForwardDepth: 0, crossFileMinDepth: 99 }, '/virtual');

      expect(findKinds(analysis, 'thin-wrapper').length).toBe(0);
    });

    it('holds a hop whose callee name is redeclared by a non-function var (value not closed)', async () => {
      // `function w` + `var w = …` — 함수 후보는 1개지만 최상위 바인딩은 2개.
      // 런타임 값이 그 함수라는 것이 닫히지 않으므로 entry→w hop 보류(entry 미보고).
      // mid(→leaf 위임)는 leaf가 wrapper가 아니라 depth 1 — w 체인도 hop이 안 열려 미보고.
      const source = [
        'function leaf(x: number): number { return x; }',
        'function mid(x: number): number { return leaf(x); }',
        'function w(x: number): number { return mid(x); }',
        'var w2 = 5;',
        'var w = w2;',
        'const entry = (x: number): number => w(x);',
      ].join('\n');
      const summaries = await chainSummaries('/virtual/var-blocker.ts', source);

      expect(summaries.some(s => s.startsWith('entry:'))).toBe(false);
    });

    it('holds a hop whose callee name has TWO top-level declarations (ambiguous — not unique)', async () => {
      // `var` 재선언으로 동명 최상위 w가 2개 — entry의 `w` hop은 어느 선언인지 스코프
      // 해석으로 유일하게 닫히지 않으므로 보류 → entry는 depth 1(미보고). 반면 두 번째
      // w 자신의 callee(mid)는 유일하게 닫히므로 w:2 체인은 정당한 W로 유지된다.
      const source = [
        'var w = function (x: number): number { return leaf(x); };',
        'var w = function (x: number): number { return mid(x); };',
        'const mid = (x: number): number => leaf(x);',
        'const entry = (x: number): number => w(x);',
        'function leaf(x: number): number { return x; }',
      ].join('\n');

      expect(await chainSummaries('/virtual/dup-toplevel.ts', source)).toEqual(['w:2']);
    });

    it('holds a hop whose callee name also matches an import binding (redeclare-error source)', async () => {
      // 유효 TS에선 리디클레어 에러지만 파서는 받는다 — 이름이 import와 최상위 함수
      // 양쪽에 바인딩되면 유일하게 닫히지 않으므로 hop 보류 (top은 depth 1, 미보고).
      const source = [
        "import { b } from './external';",
        'function b(x: number): number { return leaf(x); }',
        'const top = (x: number): number => b(x);',
        'function leaf(x: number): number { return x; }',
      ].join('\n');

      expect(await chainSummaries('/virtual/import-collision.ts', source)).toEqual([]);
    });
  });

  describe('type-remap', () => {
    // Each row declares a type alias that is a direct synonym; `header` is the
    // reported alias name.
    const reportCases: ReportCase[] = [
      { name: 'type alias is direct synonym', source: 'type A = B;', header: 'A' },
      { name: 'exported type alias synonym', source: 'export type A = B;', header: 'A' },
      { name: 'namespace qualified type synonym', source: 'type Node = ts.Node;', header: 'Node' },
    ];

    it.each(reportCases)('analyzeIndirection - $name - reports type-remap', async ({ source, header }) => {
      // Arrange
      const program = createProgram('/virtual/remap.ts', source);
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      expectSingleKindHeader(analysis, 'type-remap', header);
    });

    // Each row is a type alias that must NOT be reported as a synonym; `filePath`
    // carries the d.ts variant for the ambient-declaration case.
    const skipCases: TypeRemapSkipCase[] = [
      { name: 'type alias to primitive keyword', filePath: '/virtual/remap.ts', source: 'type UserId = string;' },
      { name: 'type alias with generic args', filePath: '/virtual/remap.ts', source: 'type StringArray = Array<string>;' },
      { name: 'type alias with type params', filePath: '/virtual/remap.ts', source: 'type MyArray<T> = Array<T>;' },
      { name: 'union type alias', filePath: '/virtual/remap.ts', source: 'type A = B | null;' },
      { name: 'intersection type alias', filePath: '/virtual/remap.ts', source: 'type A = B & { x: 1 };' },
      { name: 'typeof type alias', filePath: '/virtual/remap.ts', source: 'const x = 1; type Config = typeof x;' },
      {
        name: 'utility type alias with generic args',
        filePath: '/virtual/remap.ts',
        source: 'type ReadonlyUser = Readonly<User>;',
      },
      { name: 'keyof type alias', filePath: '/virtual/remap.ts', source: 'type Keys = keyof User;' },
      { name: 'indexed access type alias', filePath: '/virtual/remap.ts', source: "type Name = User['name'];" },
      { name: 'template literal type alias', filePath: '/virtual/remap.ts', source: 'type E = `on${string}`;' },
      { name: 'object literal type alias', filePath: '/virtual/remap.ts', source: 'type T = { x: number };' },
      { name: 'declare type alias', filePath: '/virtual/remap.ts', source: 'declare type A = B;' },
      { name: 'd.ts file type alias', filePath: '/virtual/remap.d.ts', source: 'type A = B;' },
    ];

    it.each(skipCases)('analyzeIndirection - $name - skips', async ({ filePath, source }) => {
      // Arrange
      const program = createProgram(filePath, source);
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, 'type-remap').length).toBe(0);
    });
  });

  describe('interface-rewrap', () => {
    // Each row is an empty interface that only re-wraps its base(s); `header` is
    // the reported interface name.
    // Module marker `export {}` makes the file a module so same-name cross-file
    // merging is excluded (spec: script files are always K).
    const reportCases: ReportCase[] = [
      { name: 'empty interface with single extends in a module', source: 'export {};\ninterface A extends B {}', header: 'A' },
    ];

    it.each(reportCases)('analyzeIndirection - $name - reports interface-rewrap', async ({ source, header }) => {
      // Arrange
      const program = createProgram('/virtual/rewrap.ts', source);
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expectSingleKindHeader(analysis, 'interface-rewrap', header);
    });

    // Each row is an interface that must NOT be reported as a re-wrap. `filePath`
    // carries the d.ts variant; `gildash` carries the cross-file-merge override
    // (default mock otherwise) so the callback never needs a conditional.
    const skipCases: InterfaceRewrapSkipCase[] = [
      {
        name: 'script file (no top-level import/export) single extends',
        filePath: '/virtual/rewrap.ts',
        source: 'interface A extends B {}',
        gildash: createMockGildash(),
      },
      {
        name: 'multiple extends (composition) in a module',
        filePath: '/virtual/rewrap.ts',
        source: 'export {};\ninterface A extends B, C {}',
        gildash: createMockGildash(),
      },
      {
        name: 'generic interface with type params in a module',
        filePath: '/virtual/rewrap.ts',
        source: 'export {};\ninterface Wrap<T> extends Base {}',
        gildash: createMockGildash(),
      },
      {
        name: 'heritage with type arguments in a module',
        filePath: '/virtual/rewrap.ts',
        source: 'export {};\ninterface NumberSet extends Set<number> {}',
        gildash: createMockGildash(),
      },
      {
        name: 'interface with members',
        filePath: '/virtual/rewrap.ts',
        source: 'export {};\ninterface A extends B { x: number }',
        gildash: createMockGildash(),
      },
      {
        name: 'marker interface without extends',
        filePath: '/virtual/rewrap.ts',
        source: 'export {};\ninterface A {}',
        gildash: createMockGildash(),
      },
      {
        name: 'declare interface',
        filePath: '/virtual/rewrap.ts',
        source: 'export {};\ndeclare interface A extends B {}',
        gildash: createMockGildash(),
      },
      {
        name: 'same-file interface declaration merging',
        filePath: '/virtual/rewrap.ts',
        source: 'export {};\ninterface Foo extends Bar {}\ninterface Foo { x: number }',
        gildash: createMockGildash(),
      },
      {
        name: 'class-interface declaration merging',
        filePath: '/virtual/rewrap.ts',
        source: 'export {};\ninterface Table extends SQLWrapper {}\nclass Table implements SQLWrapper { static kind = "Table"; }',
        gildash: createMockGildash(),
      },
      {
        name: 'cross-file declaration merging',
        filePath: '/virtual/rewrap.ts',
        source: 'export {};\ninterface Express extends Base {}',
        gildash: createMockGildash({
          searchSymbols: () => [
            { name: 'Express', filePath: '/virtual/rewrap.ts', kind: 'interface' } as unknown as SymbolSearchResult,
            { name: 'Express', filePath: '/virtual/other.ts', kind: 'interface' } as unknown as SymbolSearchResult,
          ],
        }),
      },
      {
        name: 'module augmentation interface',
        filePath: '/virtual/rewrap.ts',
        source: "export {};\ndeclare module 'express' { interface Request extends Base {} }",
        gildash: createMockGildash(),
      },
      {
        name: 'd.ts file interface',
        filePath: '/virtual/rewrap.d.ts',
        source: 'interface A extends B {}',
        gildash: createMockGildash(),
      },
    ];

    it.each(skipCases)('analyzeIndirection - $name - skips', async ({ filePath, source, gildash }) => {
      // Arrange
      const program = createProgram(filePath, source);
      // Act
      const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');

      // Assert
      expect(findKinds(analysis, 'interface-rewrap').length).toBe(0);
    });
  });

  describe('crossFileMinDepth', () => {
    // Scenario:
    //   a.ts: export function foo(x) { return bar(x); }  — thin-wrapper, calls bar from b.ts
    //   b.ts: export function bar(x) { return baz(x); }  — thin-wrapper, calls baz from c.ts
    //   c.ts: export function baz(x) { return x + 1; }   — non-wrapper (terminal, not in crossFileWrappers)
    //
    // Depth resolution (each registered wrapper has base depth 1 — it delegates once):
    //   bar→baz, baz is not a wrapper → bar.depth = 1
    //   foo→bar, bar is a wrapper (depth 1) → foo.depth = 1 + 1 = 2
    //
    // So: foo.depth=2, bar.depth=1
    const buildCrossFileSetup = () => {
      const files = [
        parseSource('/virtual/a.ts', 'import { bar } from "./b";\nexport function foo(x: any) { return bar(x); }'),
        parseSource('/virtual/b.ts', 'import { baz } from "./c";\nexport function bar(x: any) { return baz(x); }'),
        parseSource('/virtual/c.ts', 'export function baz(x: any) { return x + 1; }'),
      ];
      const gildash = createMockGildash({
        searchRelations: () => [
          {
            type: 'imports' as const,
            srcFilePath: '/virtual/a.ts',
            srcSymbolName: 'bar',
            dstFilePath: '/virtual/b.ts',
            dstSymbolName: 'bar',
          },
          {
            type: 'imports' as const,
            srcFilePath: '/virtual/b.ts',
            srcSymbolName: 'baz',
            dstFilePath: '/virtual/c.ts',
            dstSymbolName: 'baz',
          },
        ],
        searchSymbols: () => [
          { name: 'foo', filePath: '/virtual/a.ts' } as unknown as import('@zipbul/gildash').SymbolSearchResult,
          { name: 'bar', filePath: '/virtual/b.ts' } as unknown as import('@zipbul/gildash').SymbolSearchResult,
          { name: 'baz', filePath: '/virtual/c.ts' } as unknown as import('@zipbul/gildash').SymbolSearchResult,
        ],
      });

      return { files, gildash };
    };

    it('analyzeIndirection - cross-file chain foo.depth 2 with minDepth 2 - reports foo, skips bar', async () => {
      // Arrange: foo.depth=2 ≥ 2 reports; bar.depth=1 < 2 skipped.
      const { files, gildash } = buildCrossFileSetup();
      // Act
      const analysis = await analyzeIndirection(gildash, files, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
      const crossFindings = findKinds(analysis, 'cross-file-forwarding-chain');

      // Assert
      expect(crossFindings.map(f => f.header)).toEqual(['foo']);
      expect(crossFindings[0]?.depth).toBe(2);
    });

    it('analyzeIndirection - cross-file chain with minDepth 3 - skips all (max depth is 2)', async () => {
      // Arrange: foo.depth=2 < minDepth=3 → no findings
      const { files, gildash } = buildCrossFileSetup();
      // Act
      const analysis = await analyzeIndirection(gildash, files, { maxForwardDepth: 0, crossFileMinDepth: 3 }, '/virtual');
      const crossFindings = findKinds(analysis, 'cross-file-forwarding-chain');

      // Assert
      expect(crossFindings.length).toBe(0);
    });

    it('analyzeIndirection - cross-file terminal wrapper with minDepth 1 - reports bar', async () => {
      // Arrange: bar.depth=1 (bar→baz, baz is not a wrapper) → reported at minDepth ≤ 1.
      const { files, gildash } = buildCrossFileSetup();
      // Act
      const analysis = await analyzeIndirection(gildash, files, { maxForwardDepth: 0, crossFileMinDepth: 1 }, '/virtual');
      const crossFindings = findKinds(analysis, 'cross-file-forwarding-chain');

      // Assert — both foo (2) and bar (1) reported at minDepth 1.
      expect(crossFindings.some(f => f.header === 'bar' && f.depth === 1)).toBe(true);
      expect(crossFindings.some(f => f.header === 'foo' && f.depth === 2)).toBe(true);
    });
  });

  describe('type-remap generic variation (always K)', () => {
    // Generic aliases (typeArg or typeParam present) are always K — structural
    // equivalence is a semantic-layer judgement, out of scope. No gildash path.
    const genericAliasCases: NameSourceCase[] = [
      { name: 'utility type with type argument', source: 'type ReadonlyUser = Readonly<User>;' },
      { name: 'alias with type parameter', source: 'type M<T> = Array<T>;' },
    ];

    it.each(genericAliasCases)('analyzeIndirection - $name - skips type-remap', async ({ source }) => {
      // Arrange — isTypeAssignableTo must never be consulted (no semantic path).
      let called = false;
      const program = createProgram('/virtual/remap.ts', source);
      const gildash = createMockGildash({
        isTypeAssignableTo: () => {
          called = true;

          return true;
        },
      });
      // Act
      const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
      const remaps = findKinds(analysis, 'type-remap');

      // Assert
      expect(remaps.length).toBe(0);
      expect(called).toBe(false);
    });
  });

  /* ---------------------------------------------------------------- */
  /*  B-series — spec branch coverage (closed-rule gates)              */
  /* ---------------------------------------------------------------- */

  const wrapperHeaders = async (source: string, filePath = '/virtual/b.ts'): Promise<string[]> => {
    const program = createProgram(filePath, source);
    const analysis = await analyzeIndirection(
      createMockGildash(),
      program,
      { maxForwardDepth: 1, crossFileMinDepth: 2 },
      '/virtual',
    );

    return findKinds(analysis, 'thin-wrapper').map(f => f.header);
  };

  describe('B1 reference / identity gate (②)', () => {
    // `cb` is `const cb = x => f(x)`. A non-direct-call reach makes it K.
    const cases: WrapperExpectCase[] = [
      { name: 'direct call only', source: 'function f(x){return x;}\nconst cb = x => f(x);\ncb(1);', expectWrapper: true },
      {
        name: 'CallExpression argument',
        source: 'function f(x){return x;}\nconst cb = x => f(x);\n[1].map(cb);',
        expectWrapper: false,
      },
      {
        name: 'NewExpression argument',
        source: 'function f(x){return x;}\nconst cb = x => f(x);\nnew Set([cb]);\ncb;',
        expectWrapper: false,
      },
      {
        name: '=== operand',
        source: 'function f(x){return x;}\nconst cb = x => f(x);\nconst g = cb;\nif (g === cb) {}',
        expectWrapper: false,
      },
      { name: 'array element', source: 'function f(x){return x;}\nconst cb = x => f(x);\nconst a = [cb];', expectWrapper: false },
      {
        name: 'return value',
        source: 'function f(x){return x;}\nfunction make(){ const cb = x => f(x); return cb; }',
        expectWrapper: false,
      },
      { name: 'export value', source: 'function f(x){return x;}\nconst cb = x => f(x);\nexport { cb };', expectWrapper: false },
      {
        name: 'spread element',
        source: 'function f(x){return x;}\nconst cb = x => f(x);\nconst a = [...[cb]];\ncb;',
        expectWrapper: false,
      },
      {
        name: 'fixpoint alias reach',
        source: 'function f(x){return x;}\nconst cb = x => f(x);\nconst w2 = cb;\n[1].map(w2);',
        expectWrapper: false,
      },
    ];

    it.each(cases)('analyzeIndirection - $name - wrapper=$expectWrapper', async ({ source, expectWrapper }) => {
      // Act
      const headers = await wrapperHeaders(source);

      // Assert
      expect(headers.includes('cb')).toBe(expectWrapper);
    });

    it('analyzeIndirection - property-init delegate - skips (aliasing not closed)', async () => {
      // Arrange
      const source = 'function f(x){return x;}\nconst obj = { h: (x) => f(x) };\nobj.h(1);';
      // Act
      const headers = await wrapperHeaders(source);

      // Assert
      expect(headers.includes('h')).toBe(false);
    });
  });

  describe('B2 receiver gate (③)', () => {
    const cases: WrapperExpectCase[] = [
      {
        name: 'parameter receiver',
        source: 'const w = (p: any, x: any) => p.method(x);\nw({} as any, 1);',
        expectWrapper: true,
      },
      {
        name: 'external object receiver',
        source: 'declare const obj: any;\nconst w = (x: any) => obj.method(x);\nw(1);',
        expectWrapper: false,
      },
      {
        name: 'this receiver',
        source: 'class C { m(x: any){ return x; } run = (x: any) => this.m(x); }',
        expectWrapper: false,
      },
      {
        name: 'import-namespace receiver',
        source: "import * as ns from './ns';\nconst w = (x: any) => ns.fn(x);\nw(1);",
        expectWrapper: false,
      },
    ];

    it.each(cases)('analyzeIndirection - $name - wrapper=$expectWrapper', async ({ source, expectWrapper }) => {
      // Act
      const headers = await wrapperHeaders(source);

      // Assert
      expect(headers.includes('w')).toBe(expectWrapper);
    });
  });

  describe('B3 argument transform (①)', () => {
    // Every case is K: the wrapper `w` transforms arguments, so it must not appear.
    const cases: NameSourceCase[] = [
      { name: 'literal injection', source: 'function f(a: any, b: any){return a;}\nconst w = (x: any) => f(x, true);\nw(1);' },
      { name: 'reordering', source: 'function f(a: any, b: any){return a;}\nconst w = (a: any, b: any) => f(b, a);\nw(1, 2);' },
      { name: 'rest to identifier', source: 'function f(a: any){return a;}\nconst w = (...a: any[]) => f(a);\nw(1);' },
      { name: 'non-rest to spread', source: 'function f(a: any){return a;}\nconst w = (x: any[]) => f(...x);\nw([1]);' },
      { name: 'optional chain call', source: 'declare const f: any;\nconst w = (x: any) => f?.(x);\nw(1);' },
      {
        name: 'destructuring decomposition',
        source: 'function f(a: any, b: any){return a;}\nconst w = ({ a, b }: any) => f(a, b);\nw({});',
      },
    ];

    it.each(cases)('analyzeIndirection - $name - skips wrapper', async ({ source }) => {
      // Act
      const headers = await wrapperHeaders(source);

      // Assert
      expect(headers.includes('w')).toBe(false);
    });
  });

  describe('B4 narrowing / async / generator / accessor / method (④⑤⑥)', () => {
    // Reuses ReportCase {name, source, header} — same shape, single change-point.
    const cases: ReportCase[] = [
      {
        name: 'type predicate return',
        source: 'declare function check(v: any): boolean;\nconst w = (v: any): v is string => check(v);\nw(1);',
        header: 'w',
      },
      {
        name: 'asserts return',
        source: 'declare function check(v: any): void;\nfunction w(v: any): asserts v is string { return check(v); }\nw(1);',
        header: 'w',
      },
      {
        name: 'generator delegation',
        source: 'function* f(x: any){ yield x; }\nfunction* w(x: any){ yield* f(x); }\nw(1);',
        header: 'w',
      },
      {
        name: 'async await delegation',
        source: 'declare function f(x: any): Promise<any>;\nconst w = async (x: any) => await f(x);\nw(1);',
        header: 'w',
      },
      {
        name: 'class method delegation',
        source: 'function f(x: any){return x;}\nclass C { m(x: any){ return f(x); } }',
        header: 'm',
      },
      { name: 'get accessor delegation', source: 'class C { _f(){ return 1; } get x(){ return this._f(); } }', header: 'x' },
    ];

    it.each(cases)('analyzeIndirection - $name - skips', async ({ source, header }) => {
      // Act
      const headers = await wrapperHeaders(source);

      // Assert
      expect(headers.includes(header)).toBe(false);
    });
  });

  describe('B5 generic variation / class (⑦)', () => {
    interface TypeSkipCase {
      name: string;
      source: string;
      kind: 'type-remap' | 'interface-rewrap';
    }

    const cases: TypeSkipCase[] = [
      { name: 'utility type arg', source: 'type A = Readonly<B>;', kind: 'type-remap' },
      { name: 'alias type param', source: 'type M<T> = Array<T>;', kind: 'type-remap' },
      { name: 'generic interface', source: 'export {};\ninterface Wrap<T> extends Base {}', kind: 'interface-rewrap' },
      { name: 'heritage type arg', source: 'export {};\ninterface NumberSet extends Set<number> {}', kind: 'interface-rewrap' },
    ];

    it.each(cases)('analyzeIndirection - $name - skips $kind', async ({ source, kind }) => {
      // Arrange
      const program = createProgram('/virtual/b.ts', source);
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert
      expect(findKinds(analysis, kind).length).toBe(0);
    });

    it('analyzeIndirection - empty class extends - no class indirection kind', async () => {
      // Arrange — class re-wrap creates runtime identity; there is no class kind.
      const source = 'class B {}\nclass A extends B {}';
      const program = createProgram('/virtual/b.ts', source);
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 0, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert — no finding of any kind references the class as a re-wrap.
      expect(analysis.some(f => f.header === 'A')).toBe(false);
    });
  });

  describe('B6 forward-chain depth boundaries (BVA)', () => {
    const chainSource = (n: number): string => {
      // a0 → a1 → ... → a(n-1) → target. a0.depth = n.
      const lines: string[] = ['function target(x: any){ return x; }'];

      for (let i = 0; i < n; i += 1) {
        const next = i === n - 1 ? 'target' : `a${i + 1}`;

        lines.push(`function a${i}(x: any){ return ${next}(x); }`);
      }

      lines.push('a0(1);');

      return lines.join('\n');
    };

    const chainHeaders = async (n: number, maxForwardDepth: number): Promise<string[]> => {
      const program = createProgram('/virtual/chain.ts', chainSource(n));
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth, crossFileMinDepth: 2 },
        '/virtual',
      );

      return findKinds(analysis, 'forward-chain').map(f => f.header);
    };

    it('analyzeIndirection - 2 hops, maxForwardDepth 1 - reports a0 (depth 2 > 1)', async () => {
      expect(await chainHeaders(2, 1)).toEqual(['a0']);
    });

    it('analyzeIndirection - 3 hops, maxForwardDepth 2 - reports only a0 (depth 3 > 2)', async () => {
      expect(await chainHeaders(3, 2)).toEqual(['a0']);
    });

    it('analyzeIndirection - 2 hops, maxForwardDepth 2 - boundary equal, no report', async () => {
      expect(await chainHeaders(2, 2)).toEqual([]);
    });

    it('analyzeIndirection - 1 hop, maxForwardDepth 1 - boundary equal, no report', async () => {
      expect(await chainHeaders(1, 1)).toEqual([]);
    });

    it('analyzeIndirection - same-file cycle a->b->a - unreported (infinite recursion)', async () => {
      // Arrange
      const source = 'function a(x: any){ return b(x); }\nfunction b(x: any){ return a(x); }\na(1);';
      const program = createProgram('/virtual/cycle.ts', source);
      // Act
      const analysis = await analyzeIndirection(
        createMockGildash(),
        program,
        { maxForwardDepth: 1, crossFileMinDepth: 2 },
        '/virtual',
      );

      // Assert — same-file cycles are out of scope.
      expect(findKinds(analysis, 'forward-chain').length).toBe(0);
    });
  });

  describe('thin-wrapper decorator filter', () => {
    it('analyzeIndirection - decorated wrapper function - skips thin-wrapper', async () => {
      // Arrange: wrapper has decorators (e.g. @Injectable) — intentional wrapping
      const source = [
        'function target(value) {',
        '  return value;',
        '}',
        'function wrapper(value) {',
        '  return target(value);',
        '}',
      ].join('\n');
      const program = createProgram('/virtual/decorated.ts', source);
      const gildash = createMockGildash({
        getFullSymbol: (name, _filePath) => {
          if (name === 'wrapper') {
            return {
              name: 'wrapper',
              kind: 'function',
              filePath: '/virtual/decorated.ts',
              isExported: false,
              span: { start: { line: 4, column: 0 }, end: { line: 6, column: 1 } },
              id: 1,
              signature: 'params:1|async:0',
              fingerprint: null,
              decorators: [{ name: 'Injectable' }],
            } as unknown as FullSymbol;
          }

          return null;
        },
      });
      // Act
      const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
      const thinWrappers = findKinds(analysis, 'thin-wrapper');

      // Assert: decorated wrapper should be skipped
      expect(thinWrappers.some(f => f.header === 'wrapper')).toBe(false);
    });

    it('analyzeIndirection - undecorated wrapper function - reports thin-wrapper', async () => {
      // Arrange: wrapper has no decorators → still flagged
      const source = [
        'function target(value) {',
        '  return value;',
        '}',
        'function wrapper(value) {',
        '  return target(value);',
        '}',
      ].join('\n');
      const program = createProgram('/virtual/nodecorators.ts', source);
      const gildash = createMockGildash({
        getFullSymbol: (name, _filePath) => {
          if (name === 'wrapper') {
            return {
              name: 'wrapper',
              kind: 'function',
              filePath: '/virtual/nodecorators.ts',
              isExported: false,
              span: { start: { line: 4, column: 0 }, end: { line: 6, column: 1 } },
              id: 1,
              signature: 'params:1|async:0',
              fingerprint: null,
              decorators: [],
              detail: { modifiers: [] },
            } as unknown as FullSymbol;
          }

          return null;
        },
      });
      // Act
      const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
      const thinWrappers = findKinds(analysis, 'thin-wrapper');

      // Assert: no decorators → still flagged as thin-wrapper
      expect(thinWrappers.some(f => f.header === 'wrapper')).toBe(true);
    });

    it('analyzeIndirection - getFullSymbol throws - keeps existing thin-wrapper behavior', async () => {
      // Arrange: getFullSymbol throws — fallback to original behavior
      const source = [
        'function target(value) {',
        '  return value;',
        '}',
        'function wrapper(value) {',
        '  return target(value);',
        '}',
      ].join('\n');
      const program = createProgram('/virtual/fallback.ts', source);
      const gildash = createMockGildash({
        getFullSymbol: () => {
          throw new GildashError('semantic', 'gildash unavailable');
        },
      });
      // Act
      const analysis = await analyzeIndirection(gildash, program, { maxForwardDepth: 0, crossFileMinDepth: 2 }, '/virtual');
      const thinWrappers = findKinds(analysis, 'thin-wrapper');

      // Assert: error swallowed, original thin-wrapper finding preserved
      expect(thinWrappers.some(f => f.header === 'wrapper')).toBe(true);
    });
  });
});
