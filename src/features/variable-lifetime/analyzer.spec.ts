import { describe, expect, it } from 'bun:test';

import type {
  LivenessPressureFinding,
  MutationDensityFinding,
  ScopeNarrowingFinding,
  VariableLifetimeFinding,
} from '../../types';

import { parsePFile as file, parsePFileWithErrors as fileWithErrors } from '../../../test/integration/shared/test-kit';
import { parseSource } from '../../engine/ast/parse-source';
import { analyzeVariableLifetime, createEmptyVariableLifetime, __testing__ } from './analyzer';

const { isPureInitializer } = __testing__;

type AnyFinding = VariableLifetimeFinding | ScopeNarrowingFinding | LivenessPressureFinding | MutationDensityFinding;

const lifetimeOnly = (findings: ReadonlyArray<AnyFinding>): ReadonlyArray<VariableLifetimeFinding> =>
  findings.filter((f): f is VariableLifetimeFinding => f.kind === 'variable-lifetime');

const scopeOnly = (findings: ReadonlyArray<AnyFinding>): ReadonlyArray<ScopeNarrowingFinding> =>
  findings.filter((f): f is ScopeNarrowingFinding => f.kind === 'scope-narrowing');

const livenessOnly = (findings: ReadonlyArray<AnyFinding>): ReadonlyArray<LivenessPressureFinding> =>
  findings.filter((f): f is LivenessPressureFinding => f.kind === 'liveness-pressure');

const mutationOnly = (findings: ReadonlyArray<AnyFinding>): ReadonlyArray<MutationDensityFinding> =>
  findings.filter((f): f is MutationDensityFinding => f.kind === 'mutation-density');

const filler = (count: number, prefix = 'x') =>
  Array.from({ length: count }, (_, i) => `  const ${prefix}${i} = ${i};`).join('\n');

// Run the analyzer on a single in-memory source file. Almost every test below
// is "parse this source under src/a.ts, then run analyzeVariableLifetime with
// these options"; hoisting that shape keeps the per-test code about the actual
// case data, not the harness boilerplate.
const run = (
  sourceText: string,
  options: Parameters<typeof analyzeVariableLifetime>[1],
  filePath = 'src/a.ts',
): ReadonlyArray<AnyFinding> => analyzeVariableLifetime([file(filePath, sourceText)] as any, options);

/** Run analysis and return all of `selector`'s findings. */
const selectAll = <T>(
  sourceText: string,
  selector: (findings: ReadonlyArray<AnyFinding>) => ReadonlyArray<T>,
  options: Parameters<typeof analyzeVariableLifetime>[1],
): ReadonlyArray<T> => selector(run(sourceText, options));

/** Run analysis and return `selector`'s findings for `variable`. */
const selectFor = <T extends { readonly variable: string }>(
  sourceText: string,
  selector: (findings: ReadonlyArray<AnyFinding>) => ReadonlyArray<T>,
  variable: string,
  options: Parameters<typeof analyzeVariableLifetime>[1],
): ReadonlyArray<T> => selector(run(sourceText, options)).filter(f => f.variable === variable);

/** Run analysis on `sourceText` and assert `selector` finds exactly `count` findings for `variable`. */
const expectVarCount = (
  sourceText: string,
  selector: (findings: ReadonlyArray<AnyFinding>) => ReadonlyArray<{ readonly variable: string }>,
  variable: string,
  count: number,
  options: Parameters<typeof analyzeVariableLifetime>[1],
): void => {
  const result = run(sourceText, options);

  expect(selector(result).filter(f => f.variable === variable).length).toBe(count);
};

// Parse `const x = <expr>;` inside a function and return the initializer node.
const parseInit = (expr: string) => {
  const parsed = parseSource('/p/a.ts', `function f() { const x = ${expr}; }`);

  // Program -> FunctionDeclaration -> body -> VariableDeclaration -> declarator -> init
  return (parsed.program as any).body[0].body.body[0].declarations[0].init;
};

describe('variable-lifetime/analyzer', () => {
  // ── Guard / 입력 검증 ──

  it('analyzeVariableLifetime - empty file list - returns empty result', () => {
    // Arrange
    const files: any[] = [];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 3 });

    // Assert
    expect(result).toEqual(createEmptyVariableLifetime());
  });

  it('analyzeVariableLifetime - file with parse errors - skips file', () => {
    // Arrange
    const files = [fileWithErrors('src/a.ts', 'function f() { const a = 1;\nreturn a; }')];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 0 });

    // Assert
    expect(result.length).toBe(0);
  });

  // 입력별로 동일하게 "분석 후 결과 0건"을 확인하는 가드 케이스들. 차이는 입력 소스/경로뿐이다.
  it.each([
    ['non-ts file - skips file', 'src/a.js', 'function f() { const a = 1;\nreturn a; }'],
    ['function with no local variables - no findings', 'src/a.ts', 'function f() { return 1; }'],
    ['empty function body - no findings', 'src/a.ts', 'function f() {}'],
  ])('analyzeVariableLifetime - %s', (_name, path, sourceText) => {
    // Act
    const result = run(sourceText, { maxLifetimeLines: 0 }, path);

    // Assert
    expect(result.length).toBe(0);
  });

  // ── 핵심 동작: 임계값 ──

  it('analyzeVariableLifetime - lifetime exceeds threshold - reports finding', () => {
    // Arrange
    const sourceText = ['function f() {', '  const x = 1;', filler(5), '  return x;', '}'].join('\n');
    // Act
    const lt = selectAll(sourceText, lifetimeOnly, { maxLifetimeLines: 2 });

    expect(lt.length).toBe(1);
    expect(lt[0]?.lifetimeLines).toBeGreaterThan(2);
  });

  it('analyzeVariableLifetime - lifetime within threshold - no finding', () => {
    // Arrange
    const sourceText = ['function f() {', '  const x = 1;', '  return x;', '}'].join('\n');
    // Act
    const result = run(sourceText, { maxLifetimeLines: 10 });

    // Assert
    expect(result.length).toBe(0);
  });

  it('analyzeVariableLifetime - negative maxLifetimeLines - clamps to 0', () => {
    // Arrange
    const sourceText = ['function f() {', '  const x = 1;', '  const a = 1;', '  return x;', '}'].join('\n');
    // Act
    const result = run(sourceText, { maxLifetimeLines: -1 });

    // Assert
    expect(result.length).toBe(1);
  });

  // ── 경계값 ──

  it('analyzeVariableLifetime - lifetime equals threshold exactly - not reported', () => {
    // Arrange — lifetime = 3 lines (line 2 to line 5)
    const sourceText = [
      'function f() {',
      '  const x = 1;', // line 2
      '  const a = 0;', // line 3
      '  const b = 0;', // line 4
      '  return x + a + b;', // line 5, lifetime = 3
      '}',
    ].join('\n');

    // Act
    expectVarCount(sourceText, lifetimeOnly, 'x', 0, { maxLifetimeLines: 3 });
  });

  it('analyzeVariableLifetime - lifetime one above threshold - reported', () => {
    // Arrange — lifetime = 4 lines (line 2 to line 6)
    const sourceText = [
      'function f() {',
      '  const x = 1;', // line 2
      '  const a = 0;', // line 3
      '  const b = 0;', // line 4
      '  const c = 0;', // line 5
      '  return x + a + b + c;', // line 6, lifetime = 4
      '}',
    ].join('\n');

    // Act
    expectVarCount(sourceText, lifetimeOnly, 'x', 1, { maxLifetimeLines: 3 });
  });

  it('analyzeVariableLifetime - maxLifetimeLines 0 - single line gap reports', () => {
    // Arrange — x declared on line 2, used on line 3, lifetime = 1 > 0
    const sourceText = ['function f() {', '  const x = 1;', '  return x;', '}'].join('\n');
    // Act
    const lt = selectAll(sourceText, lifetimeOnly, { maxLifetimeLines: 0 });

    expect(lt.filter(f => f.variable === 'x').length).toBe(1);
    expect(lt[0]?.lifetimeLines).toBe(1);
  });

  it('analyzeVariableLifetime - same line declaration and use - lifetime 0 not reported', () => {
    // Arrange — all on one line, lifetime = 0
    const sourceText = 'function f() { const x = 1; return x; }';

    // Act
    expectVarCount(sourceText, lifetimeOnly, 'x', 0, { maxLifetimeLines: 0 });
  });

  // ── 기존 regex 버그 수정 확인 ──

  it('analyzeVariableLifetime - variable name in string literal - does not extend lifetime', () => {
    // Arrange — 'x' appears as string literal, should not count as use
    const sourceText = [
      'function f() {',
      '  const x = 1;', // line 2
      '  const a = "x is a variable";', // string literal, NOT a use of x
      '  const b = 0;',
      '  const c = 0;',
      '  const d = 0;',
      '  const e = 0;',
      '  console.log(a, b, c, d, e);',
      '  return x;', // line 9, actual last use
      '}',
    ].join('\n');
    // Act
    const xFindings = selectFor(sourceText, lifetimeOnly, 'x', { maxLifetimeLines: 5 });

    expect(xFindings.length).toBe(1);
    expect(xFindings[0]?.lifetimeLines).toBe(7);
  });

  it('analyzeVariableLifetime - variable name in comment - does not extend lifetime', () => {
    // Arrange — 'x' appears in comment, should not count as use
    const sourceText = [
      'function f() {',
      '  const x = 1;', // line 2
      '  // use x later',
      '  return x;', // line 4, actual last use
      '}',
    ].join('\n');

    // Act
    expectVarCount(sourceText, lifetimeOnly, 'x', 0, { maxLifetimeLines: 5 });
  });

  it('analyzeVariableLifetime - module-level variable - not analyzed', () => {
    // Arrange — module-level const, not inside any function
    const sourceText = [
      'const x = 1;',
      'const a = 2;',
      'const b = 3;',
      'const c = 4;',
      'const d = 5;',
      'const e = 6;',
      'export const y = x + a + b + c + d + e;',
    ].join('\n');
    // Act
    const result = run(sourceText, { maxLifetimeLines: 2 });

    // Assert — no function body → no analysis
    expect(result.length).toBe(0);
  });

  // ── 스코프 ──

  it('analyzeVariableLifetime - same-name variables in different functions - isolated scopes', () => {
    // Arrange — x in function a (lifetime 1), x in function b (lifetime 1)
    const sourceText = [
      'function a() {',
      '  const x = 1;',
      '  return x;',
      '}',
      'function b() {',
      filler(6, 'y'),
      '  const x = 2;',
      '  return x;',
      '}',
    ].join('\n');

    // Act
    expectVarCount(sourceText, lifetimeOnly, 'x', 0, { maxLifetimeLines: 5 });
  });

  it('analyzeVariableLifetime - nested function use - does not extend outer variable lifetime', () => {
    // Arrange — x used inside nested function, should NOT count for outer function
    const sourceText = [
      'function outer() {',
      '  const x = 1;', // line 2
      '  function inner() {',
      '    return x;', // nested use — excluded by includeNestedFunctions: false
      '  }',
      filler(6, 'pad'),
      '  return inner();', // x is NOT used here directly
      '}',
    ].join('\n');

    // Act
    expectVarCount(sourceText, lifetimeOnly, 'x', 0, { maxLifetimeLines: 5 });
  });

  // ── 제어 흐름 ──

  it('analyzeVariableLifetime - early return - dead code after return excluded', () => {
    // Arrange
    const sourceText = [
      'function f(cond: boolean) {',
      '  const x = 1;',
      '  if (cond) return 0;',
      '  return x;', // x lifetime is 2
      '}',
    ].join('\n');

    // Act
    expectVarCount(sourceText, lifetimeOnly, 'x', 0, { maxLifetimeLines: 5 });
  });

  it('analyzeVariableLifetime - if/else both branches use variable - uses farther branch for lifetime', () => {
    // Arrange
    const sourceText = [
      'function f(cond: boolean) {',
      '  const x = 1;', // line 2
      filler(6, 'pad'),
      '  if (cond) {',
      '    return x;', // far use
      '  } else {',
      '    return x + 1;', // also far use
      '  }',
      '}',
    ].join('\n');

    // Act
    expectVarCount(sourceText, lifetimeOnly, 'x', 1, { maxLifetimeLines: 5 });
  });

  it('analyzeVariableLifetime - loop body use - variable lifetime spans to loop', () => {
    // Arrange
    const sourceText = [
      'function f(items: number[]) {',
      '  const multiplier = 2;', // line 2
      filler(6, 'pad'),
      '  for (const item of items) {',
      '    console.log(item * multiplier);', // use far from def
      '  }',
      '}',
    ].join('\n');

    // Act
    expectVarCount(sourceText, lifetimeOnly, 'multiplier', 1, { maxLifetimeLines: 5 });
  });

  it('analyzeVariableLifetime - try/catch - variable used in catch block', () => {
    // Arrange
    const sourceText = [
      'function f() {',
      '  const resource = acquire();', // line 2
      '  try {',
      filler(6, 'op'),
      '    process();',
      '  } catch (e) {',
      '    release(resource);', // use in catch, far from def
      '  }',
      '}',
    ].join('\n');

    // Act
    expectVarCount(sourceText, lifetimeOnly, 'resource', 1, { maxLifetimeLines: 5 });
  });

  // ── 재할당 / let ──

  it('analyzeVariableLifetime - unconditional reassignment - only surviving def lifetime counted', () => {
    // Arrange
    const sourceText = [
      'function f() {',
      '  let x = 1;', // def1 — killed by unconditional x = 2
      '  x = 2;', // def2
      filler(6, 'pad'),
      '  return x;', // only def2 reaches here
      '}',
    ].join('\n');
    // Act
    const xFindings = selectFor(sourceText, lifetimeOnly, 'x', { maxLifetimeLines: 5 });

    expect(xFindings.length).toBe(1);
  });

  it('analyzeVariableLifetime - conditional reassignment - both defs generate independent findings', () => {
    // Arrange — def1 is NOT killed because def2 is conditional
    const sourceText = [
      'function f(cond: boolean) {',
      '  let x = 1;', // def1, line 2
      '  if (cond) {',
      '    x = 2;', // def2, line 4 (conditional — does NOT kill def1)
      '  }',
      filler(6, 'pad'),
      '  return x;', // BOTH def1 and def2 reach here
      '}',
    ].join('\n');
    // Act
    const xFindings = selectFor(sourceText, lifetimeOnly, 'x', { maxLifetimeLines: 5 });

    expect(xFindings.length).toBe(2);

    // def1 has longer lifetime than def2
    const lifetimes = xFindings.map(f => f.lifetimeLines).sort((a, b) => b - a);

    expect(lifetimes[0]).toBeGreaterThan(lifetimes[1]!);
  });

  // ── 파라미터 / 구조분해 ──

  it('analyzeVariableLifetime - parameter - excluded from findings (cannot move)', () => {
    // Arrange
    const sourceText = [
      'function f(param: number) {', // line 1
      filler(6, 'pad'),
      '  return param;', // line 8
      '}',
    ].join('\n');
    // Act
    const paramFindings = selectFor(sourceText, lifetimeOnly, 'param', { maxLifetimeLines: 5 });

    expect(paramFindings.length).toBe(0);
  });

  it('analyzeVariableLifetime - destructuring - each binding has independent lifetime', () => {
    // Arrange
    const sourceText = [
      'function f(obj: { a: number; b: number }) {',
      '  const { a, b } = obj;', // line 2
      filler(6, 'pad'),
      '  const r1 = a;', // a use
      '  return r1 + b;', // b use, one line further
      '}',
    ].join('\n');

    // Act
    expectVarCount(sourceText, lifetimeOnly, 'a', 1, { maxLifetimeLines: 5 });
    expectVarCount(sourceText, lifetimeOnly, 'b', 1, { maxLifetimeLines: 5 });
  });

  // ── 함수 종류 ──

  // arrow function / function expression both wrap the same body and must be analyzed.
  it.each([
    ['arrow function', 'const f = () => {', '};'],
    ['function expression', 'const f = function() {', '};'],
  ])('analyzeVariableLifetime - %s - analyzed', (_name, open, close) => {
    // Arrange
    const sourceText = [
      open,
      '  const x = 1;', // line 2
      filler(6, 'pad'),
      '  return x;', // line 9
      close,
    ].join('\n');

    // Act
    expectVarCount(sourceText, lifetimeOnly, 'x', 1, { maxLifetimeLines: 5 });
  });

  // ── 사용 없는 변수 ──

  it('analyzeVariableLifetime - variable declared but never used - no finding', () => {
    // Arrange
    const sourceText = ['function f() {', '  const unused = 42;', filler(6, 'pad'), '  return 1;', '}'].join('\n');

    // Act
    expectVarCount(sourceText, lifetimeOnly, 'unused', 0, { maxLifetimeLines: 0 });
  });

  // ── Finding 형태 검증 ──

  it('analyzeVariableLifetime - finding fields - has all required fields with correct values', () => {
    // Arrange
    const sourceText = [
      'function f() {',
      '  const target = 1;', // line 2, column 8
      filler(6, 'pad'),
      '  return target;', // line 9
      '}',
    ].join('\n');
    // Act
    const result = run(sourceText, { maxLifetimeLines: 3 });
    // Assert
    const finding = lifetimeOnly(result).find(f => f.variable === 'target');

    expect(finding).toBeDefined();
    expect(finding?.kind).toBe('variable-lifetime');
    expect(finding?.file).toBe('src/a.ts');
    expect(finding?.variable).toBe('target');
    expect(typeof finding?.lifetimeLines).toBe('number');
    expect(finding?.lifetimeLines).toBeGreaterThan(3);
    expect(typeof finding?.contextBurden).toBe('number');
    expect(finding?.contextBurden).toBeGreaterThanOrEqual(1);
    // span.start = declaration position
    expect(finding!.span.start.line).toBe(2);
    expect(typeof finding!.span.start.column).toBe('number');
    // span.end = last use position (not defOffset+200 like old code)
    expect(finding!.span.end.line).toBeGreaterThan(finding!.span.start.line);
  });

  it('analyzeVariableLifetime - span accuracy - start is declaration, end is last use', () => {
    // Arrange
    const sourceText = [
      'function f() {',
      '  const x = 1;', // line 2, 'x' at column 8
      '  const a = 0;',
      '  const b = 0;',
      '  const c = 0;',
      '  const d = 0;',
      '  const e = 0;',
      '  return x + a + b + c + d + e;', // line 8, 'x' at column 9
      '}',
    ].join('\n');
    // Act
    const result = run(sourceText, { maxLifetimeLines: 3 });
    const finding = lifetimeOnly(result).find(f => f.variable === 'x');

    // Assert
    expect(finding).toBeDefined();
    expect(finding!.span.start.line).toBe(2);
    expect(finding!.span.start.column).toBe(8); // const [x] = 1
    expect(finding!.span.end.line).toBe(8);
  });

  // ── contextBurden 함수 단위 ──

  it('analyzeVariableLifetime - contextBurden - counts long-lived variables per function', () => {
    // Arrange — function A has 2 long-lived, function B has 1 long-lived
    const sourceText = [
      'function a() {',
      '  const x = 1;',
      '  const y = 2;',
      filler(6, 'pad'),
      '  return x + y;',
      '}',
      'function b() {',
      '  const z = 3;',
      filler(6, 'q'),
      '  return z;',
      '}',
    ].join('\n');
    // Act
    const result = run(sourceText, { maxLifetimeLines: 3 });
    // Assert
    const fnAFindings = lifetimeOnly(result).filter(f => f.variable === 'x' || f.variable === 'y');
    const fnBFindings = lifetimeOnly(result).filter(f => f.variable === 'z');

    expect(fnAFindings.length).toBe(2);
    expect(fnAFindings[0]?.contextBurden).toBe(2);
    expect(fnAFindings[1]?.contextBurden).toBe(2);
    expect(fnBFindings.length).toBe(1);
    expect(fnBFindings[0]?.contextBurden).toBe(1);
  });

  // ── 복수 파일 ──

  it('analyzeVariableLifetime - multiple files - analyzed independently', () => {
    // Arrange
    const source1 = ['function f() {', '  const a = 1;', filler(6, 'p'), '  return a;', '}'].join('\n');
    const source2 = ['function g() {', '  const b = 2;', filler(6, 'q'), '  return b;', '}'].join('\n');
    const files = [file('src/a.ts', source1), file('src/b.ts', source2)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 3 });

    // Assert
    expect(lifetimeOnly(result).filter(f => f.variable === 'a').length).toBe(1);
    expect(lifetimeOnly(result).filter(f => f.variable === 'b').length).toBe(1);
    expect(lifetimeOnly(result).filter(f => f.variable === 'a')[0]?.file).toBe('src/a.ts');
    expect(lifetimeOnly(result).filter(f => f.variable === 'b')[0]?.file).toBe('src/b.ts');
  });

  // ── scope-narrowing ───────────────────────────────────────────────────────────

  describe('isPureInitializer', () => {
    // Each row: an initializer expression and whether isPureInitializer treats it as pure.
    // `null` (no initializer) is special-cased and tested separately below.
    it.each([
      ['numeric literal', '1', true],
      ['string literal', '"hello"', true],
      ['identifier reference', 'someVar', true],
      ['binary expression with pure operands', 'a + b', true],
      ['conditional expression with pure operands', 'cond ? 1 : 2', true],
      ['call expression', 'compute()', false],
      ['new expression', 'new Foo()', false],
      ['spread in array', '[...arr]', false],
      ['object with computed key', '{ [compute()]: 1 }', false],
      ['sequence expression', '(a, b)', false],
      ['arrow function expression', '() => 1', false],
    ])('isPureInitializer - %s - returns %p', (_name, expr, expected) => {
      // Arrange
      const node = parseInit(expr);

      // Act + Assert
      expect(isPureInitializer(node)).toBe(expected);
    });

    it('isPureInitializer - null initializer (no init) - returns true', () => {
      // Arrange: null represents no initializer
      // Act + Assert
      expect(isPureInitializer(null)).toBe(true);
    });
  });

  describe('analyzeVariableLifetime - scope-narrowing', () => {
    // ── 탐지: 순수 초기화 ──
    // Each row reports a scope-narrowing finding; the expected targetBlock.type is asserted
    // when known (undefined means "just expect a finding to exist").
    it.each([
      [
        'const literal used only in if-consequent',
        'function f(cond: boolean) { const x = 1; if (cond) { use(x); } }',
        'if-consequent',
      ],
      [
        'const pure binary used only in if-consequent',
        'function f(a: number, b: number, cond: boolean) { const x = a + b; if (cond) { use(x); } }',
        'if-consequent',
      ],
      [
        'let no initializer used only in if-block',
        'function f(cond: boolean) { let x; if (cond) { x = 1; use(x); } }',
        'if-consequent',
      ],
      [
        'const used only in if-alternate block',
        'function f(a: boolean) { const x = 1; if (a) { } else { use(x); } }',
        'if-alternate',
      ],
      ['const used only in try-block', 'function f() { const x = 1; try { use(x); } catch (e) { } }', 'try-block'],
      ['const used only in catch-block', 'function f() { const x = 1; try { } catch (e) { use(x); } }', 'catch-block'],
      [
        'const used only in single switch case',
        'function f(y: string) { const x = 1; switch (y) { case "a": use(x); break; } }',
        'switch-case',
      ],
    ])('analyzeVariableLifetime - %s - detects scope-narrowing', (_name, sourceText, blockType) => {
      // Act
      const result = run(sourceText, { maxLifetimeLines: 999 });
      // Assert
      const finding = scopeOnly(result).find(f => f.variable === 'x');

      expect(finding).toBeDefined();
      expect((finding as any).targetBlock.type).toBe(blockType);
    });

    // ── 제외 시나리오: 위 어느 경우든 x에 대한 scope-narrowing finding이 없어야 한다 ──
    it.each([
      // 불순 초기화
      ['call expression initializer', 'function f(cond: boolean) { const x = compute(); if (cond) { use(x); } }'],
      ['new expression initializer', 'function f(cond: boolean) { const x = new Foo(); if (cond) { use(x); } }'],
      ['spread initializer', 'function f(arr: number[], cond: boolean) { const x = [...arr]; if (cond) { use(x); } }'],
      // 블록 밖 사용
      ['variable used outside block', 'function f(cond: boolean) { const x = 1; use(x); if (cond) { use(x); } }'],
      ['variable used in if-condition', 'function f() { const x = 1; if (x > 0) { doSomething(); } }'],
      [
        'variable used in both if-consequent and alternate',
        'function f(a: boolean) { const x = 1; if (a) { use(x); } else { use(x); } }',
      ],
      ['var declaration', 'function f(cond: boolean) { var x = 1; if (cond) { use(x); } }'],
      [
        'else-if chain (alternate is IfStatement)',
        'function f(a: boolean, b: boolean) { const x = 1; if (a) { } else if (b) { use(x); } }',
      ],
      ['variable used in loop body', 'function f(items: number[]) { const x = 1; for (const item of items) { use(x); } }'],
      // switch fall-through / 다중 case
      [
        'switch with fall-through case',
        'function f(y: string) { const x = 1; switch (y) { case "a": use(x); case "b": break; } }',
      ],
      [
        'switch with variable in multiple cases',
        'function f(y: string) { const x = 1; switch (y) { case "a": use(x); break; case "b": use(x); break; } }',
      ],
      // finally/catch 안전성
      ['variable used in finally block', 'function f() { let x = null; try { x = 1; } finally { cleanup(x); } }'],
      [
        'variable used in both try and catch blocks',
        'function f() { let x = null; try { x = 1; use(x); } catch (e) { log(x); } }',
      ],
      // intervening write
      [
        'intervening write to referenced var',
        'function f(cond: boolean) { let otherVar = 1; const x = otherVar; otherVar = 999; if (cond) { use(x); } }',
      ],
      // 불순 초기화 (computed key / sequence / arrow)
      [
        'object with computed key initializer',
        'function f(cond: boolean) { const x = { [compute()]: 1 }; if (cond) { use(x); } }',
      ],
      ['sequence expression initializer', 'function f(cond: boolean) { const x = (a, b); if (cond) { use(x); } }'],
      ['arrow function initializer used only in if-block', 'function f(cond: boolean) { const x = () => 1; if (cond) { x(); } }'],
    ])('analyzeVariableLifetime - %s - no scope-narrowing finding', (_name, sourceText) => {
      // Act
      expectVarCount(sourceText, scopeOnly, 'x', 0, { maxLifetimeLines: 999 });
    });

    it('analyzeVariableLifetime - no intervening write (function call only) - detects scope-narrowing', () => {
      // Arrange: doSomething() is a call but does not directly write otherVar — FN한계, but direct write absent means safe
      const sourceText =
        'function f(cond: boolean, otherVar: number) { const x = otherVar; doSomething(); if (cond) { use(x); } }';
      // Act
      const result = run(sourceText, { maxLifetimeLines: 999 });
      // Assert
      const finding = scopeOnly(result).find(f => f.variable === 'x');

      expect(finding).toBeDefined();
    });

    // ── Finding 형태 검증 ──

    it('analyzeVariableLifetime - scope-narrowing finding - has all required fields with exact spans', () => {
      // Arrange — single-line source so the spans pin to known line/column positions.
      const sourceText = 'function f(cond: boolean) { const target = 42; if (cond) { use(target); } }';
      // Act
      const result = run(sourceText, { maxLifetimeLines: 999 });
      // Assert
      const finding = scopeOnly(result).find(f => f.variable === 'target');

      expect(finding).toBeDefined();
      expect(finding!.kind).toBe('scope-narrowing');
      expect(finding!.file).toBe('src/a.ts');
      expect(finding!.variable).toBe('target');

      // Declaration span is the `target` identifier on line 1 (everything is on one line).
      expect(finding!.span.start.line).toBe(1);
      expect(finding!.span.end.line).toBe(1);
      // `target` identifier in `const target = 42;` starts at column 34 (0-based).
      expect(finding!.span.start.column).toBe(sourceText.indexOf('target'));
      // End column is anchored to the declarator (zero-width span at the identifier).
      expect(finding!.span.end.column).toBeGreaterThanOrEqual(finding!.span.start.column);

      // targetBlock points at the if-consequent block whose body uses target.
      const tb = (finding as any).targetBlock;

      expect(tb).toBeDefined();
      expect(tb.type).toBe('if-consequent');
      expect(tb.span).toBeDefined();
      expect(tb.span.start.line).toBe(1);
      // Consequent block starts at the `{` after `if (cond) `.
      expect(tb.span.start.column).toBe(sourceText.indexOf('{ use'));
      expect(tb.span.end.column).toBe(sourceText.indexOf('} }') + 1);
    });
  });

  // ── 엣지케이스 공격 시나리오 (attack scenarios) ────────────────────────────

  describe('analyzeVariableLifetime - edge case attack scenarios', () => {
    // 시나리오 1·2: 빈 함수 / 선언만 있고 사용 없음 — 크래시하지 않고 결과 0건인가?
    it.each([
      ['completely empty function body', 'function foo() {}'],
      ['declared but never used variable', 'function foo() { const x = 1; }'],
    ])('analyzeVariableLifetime - %s - does not crash', (_name, sourceText) => {
      // Act
      let threw = false;
      let result: any;

      try {
        result = run(sourceText, { maxLifetimeLines: 0 });
      } catch {
        threw = true;
      }

      // Assert
      expect(threw).toBe(false);
      expect(result.length).toBe(0);
    });

    // 시나리오 3: 매우 깊은 중첩 — depth-1만 잡는가?
    it('analyzeVariableLifetime - deeply nested if — only outermost if is a scope block (depth-1 only)', () => {
      // Arrange — x is used only inside if(b) { if(c) { use(x) } }
      // The outer if(a) is the only direct-child scope block. Inner ifs are not top-level.
      const sourceText = [
        'function f(a: boolean, b: boolean, c: boolean) {',
        '  const x = 1;',
        '  if (a) {',
        '    if (b) {',
        '      if (c) {',
        '        use(x);',
        '      }',
        '    }',
        '  }',
        '}',
      ].join('\n');
      // Act
      const findings = selectFor(sourceText, scopeOnly, 'x', { maxLifetimeLines: 999 });

      // Assert — scope-narrowing fires for the outermost if(a) block (depth-1)
      expect(findings.length).toBe(1);
      expect(findings[0]!.targetBlock.type).toBe('if-consequent');
    });

    // 시나리오 4: 동일 변수명 여러 함수 — 함수별 독립 분석?
    it('analyzeVariableLifetime - same variable name in two functions - analyzed independently', () => {
      // Arrange — function a: x used only in if → scope-narrowing
      //           function b: x used outside if → no scope-narrowing
      const sourceText = [
        'function a(cond: boolean) {',
        '  const x = 1;',
        '  if (cond) { use(x); }',
        '}',
        'function b(cond: boolean) {',
        '  const x = 2;',
        '  use(x);',
        '  if (cond) { doSomethingElse(); }',
        '}',
      ].join('\n');
      // Act
      const findings = selectFor(sourceText, scopeOnly, 'x', { maxLifetimeLines: 999 });

      // Assert — only function a emits scope-narrowing
      expect(findings.length).toBe(1);
    });

    // 시나리오 5: 거대 파일 — 1000줄짜리 함수에서 성능 문제 없는가?
    it('analyzeVariableLifetime - 1000-line function - completes without timeout', () => {
      // Arrange
      const lines = [
        'function bigFn(cond: boolean) {',
        '  const x = 1;',
        ...Array.from({ length: 990 }, (_, i) => `  const pad${i} = ${i};`),
        '  if (cond) { use(x); }',
        '}',
      ];
      const sourceText = lines.join('\n');
      const start = Date.now();
      // Act
      const result = run(sourceText, { maxLifetimeLines: 999 });
      const elapsed = Date.now() - start;

      // Assert — must complete in under 5 seconds
      expect(elapsed).toBeLessThan(5000);

      const findings = scopeOnly(result).filter(f => f.variable === 'x');

      expect(findings.length).toBe(1);
    });

    // 시나리오 6·7a·7b: 종료 case/block에서만 사용 — 해당 블록 타입으로 탐지하는가?
    it.each([
      [
        'switch with default case terminating',
        'function f(y: string) { const x = 1; switch (y) { case "a": break; default: use(x); break; } }',
        'switch-case',
      ],
      [
        'try-catch-finally: variable used only in try block',
        'function f() { const x = 1; try { use(x); } catch (e) { } finally { cleanup(); } }',
        'try-block',
      ],
      [
        'try-catch-finally: variable used only in catch block',
        'function f() { const x = 1; try { } catch (e) { use(x); } finally { cleanup(); } }',
        'catch-block',
      ],
    ])('analyzeVariableLifetime - %s - detects scope-narrowing', (_name, sourceText, blockType) => {
      // Act
      const findings = selectFor(sourceText, scopeOnly, 'x', { maxLifetimeLines: 999 });

      // Assert
      expect(findings.length).toBe(1);
      expect(findings[0]!.targetBlock.type).toBe(blockType as ScopeNarrowingFinding['targetBlock']['type']);
    });

    // 시나리오 7c: try-catch-finally — finally에서만 사용
    it('analyzeVariableLifetime - try-catch-finally: variable used only in finally block - no scope-narrowing finding', () => {
      // Arrange — variable used in finally: excluded by finalizer rule
      const sourceText = 'function f() { const x = 1; try { } catch (e) { } finally { use(x); } }';
      // Act
      const findings = selectFor(sourceText, scopeOnly, 'x', { maxLifetimeLines: 999 });

      // Assert — finally usage blocks scope-narrowing detection
      expect(findings.length).toBe(0);
    });
  });

  // ── Liveness pressure ──

  // 8개 변수가 동시에 살아있는 표준 본문. 함수명만 바꿔 여러 곳에서 재사용한다.
  const eightLiveVarFn = (name: string) =>
    [
      `function ${name}() {`,
      '  const a = 1;',
      '  const b = 2;',
      '  const c = 3;',
      '  const d = 4;',
      '  const e = 5;',
      '  const f = 6;',
      '  const g = 7;',
      '  const h = 8;',
      filler(45, 'pad'),
      '  return a + b + c + d + e + f + g + h;',
      '}',
    ].join('\n');

  // 임계를 넘는 함수는 정확히 1건의 liveness-pressure를 내야 한다. 차이는 함수 형태/배치뿐이며
  // 옵션은 모두 { maxLiveVariables: 7, minFunctionLines: 40 }. (8개 동시 생존 변수 + 45줄 패딩)
  it.each([
    ['long flat function with many live vars', eightLiveVarFn('bigFn')],
    [
      'arrow function with many live vars',
      [
        'const arrowFn = () => {',
        '  const a = 1;',
        '  const b = 2;',
        '  const c = 3;',
        '  const d = 4;',
        '  const e = 5;',
        '  const f = 6;',
        '  const g = 7;',
        '  const h = 8;',
        filler(45, 'pad'),
        '  return a + b + c + d + e + f + g + h;',
        '};',
      ].join('\n'),
    ],
  ])('analyzeVariableLifetime - %s - emits liveness-pressure', (_name, sourceText) => {
    // Act
    const result = run(sourceText, { maxLifetimeLines: 999, maxLiveVariables: 7, minFunctionLines: 40 });

    // Assert
    expect(livenessOnly(result).length).toBe(1);
  });

  it('analyzeVariableLifetime - short function with many live vars - no liveness-pressure (below minFunctionLines)', () => {
    // Arrange: only 5 lines long — below minFunctionLines threshold
    const sourceText = [
      'function smallFn() {',
      '  const a = 1; const b = 2; const c = 3; const d = 4; const e = 5; const f = 6; const g = 7; const h = 8;',
      '  return a + b + c + d + e + f + g + h;',
      '}',
    ].join('\n');
    // Act
    const result = run(sourceText, { maxLifetimeLines: 999, maxLiveVariables: 3, minFunctionLines: 40 });

    // Assert — function is too short, no liveness-pressure finding
    expect(livenessOnly(result).length).toBe(0);
  });

  it('analyzeVariableLifetime - long function with few live vars - no liveness-pressure (below maxLiveVariables)', () => {
    // Arrange: 50+ line function but only 2 variables alive at once
    const sourceText = [
      'function sparseFn() {',
      '  const a = 1;',
      '  const b = 2;',
      filler(50, 'pad'),
      '  return a + b;',
      '}',
    ].join('\n');
    // Act — threshold is 8 live vars, function only has 2
    const result = run(sourceText, { maxLifetimeLines: 999, maxLiveVariables: 8, minFunctionLines: 40 });

    // Assert
    expect(livenessOnly(result).length).toBe(0);
  });

  it('analyzeVariableLifetime - maxLiveCount equals threshold - emits liveness-pressure (>= semantics)', () => {
    // Arrange: 50+ line function with exactly 3 live vars, threshold set to 3
    const sourceText = [
      'function exactFn() {',
      '  const a = 1;',
      '  const b = 2;',
      '  const c = 3;',
      filler(45, 'pad'),
      '  return a + b + c;',
      '}',
    ].join('\n');
    // Act — threshold exactly matches live count
    const result = run(sourceText, { maxLifetimeLines: 999, maxLiveVariables: 3, minFunctionLines: 10 });

    // Assert — >= means it should fire when equal
    expect(livenessOnly(result).length).toBe(1);
  });

  it('analyzeVariableLifetime - liveness-pressure finding has correct maxLiveVariables and functionLineCount', () => {
    // Arrange: 50+ line function with exactly 8 simultaneously live variables
    const sourceText = eightLiveVarFn('metaFn');
    // Act
    const lp = selectAll(sourceText, livenessOnly, { maxLifetimeLines: 999, maxLiveVariables: 7, minFunctionLines: 40 });

    expect(lp.length).toBe(1);
    expect(lp[0]?.maxLiveVariables).toBeGreaterThanOrEqual(7);
    expect(lp[0]?.functionLineCount).toBeGreaterThanOrEqual(40);
    expect(typeof lp[0]?.hotSpotLine).toBe('number');
  });

  it('analyzeVariableLifetime - function parameters count as live variables - includes params in maxLiveVariables', () => {
    // Arrange: 50+ line function, 5 params + 3 local vars all alive at return, threshold 7
    const sourceText = [
      'function heavyFn(p1: number, p2: number, p3: number, p4: number, p5: number) {',
      '  const a = 1;',
      '  const b = 2;',
      '  const c = 3;',
      filler(48, 'pad'),
      '  return a + b + c + p1 + p2 + p3 + p4 + p5;',
      '}',
    ].join('\n');
    // Act
    const result = run(sourceText, { maxLifetimeLines: 999, maxLiveVariables: 7, minFunctionLines: 40 });

    // Assert
    expect(livenessOnly(result).length).toBe(1);
  });

  it('analyzeVariableLifetime - maxLiveVariables zero - fires for any function with variables', () => {
    // Arrange: 50+ line function with only 1 variable; threshold 0 should fire
    const sourceText = ['function singleVarFn() {', '  const x = 1;', filler(50, 'pad'), '  return x;', '}'].join('\n');
    // Act
    const result = run(sourceText, { maxLifetimeLines: 999, maxLiveVariables: 0, minFunctionLines: 10 });

    // Assert
    expect(livenessOnly(result).length).toBe(1);
  });

  it('analyzeVariableLifetime - minFunctionLines zero - fires even for short functions', () => {
    // Arrange: 5-line function with 8 simultaneously live vars, minFunctionLines 0
    const sourceText = [
      'function shortFn() {',
      '  const a = 1; const b = 2; const c = 3; const d = 4;',
      '  const e = 5; const f = 6; const g = 7; const h = 8;',
      '  return a + b + c + d + e + f + g + h;',
      '}',
    ].join('\n');
    // Act
    const result = run(sourceText, { maxLifetimeLines: 999, maxLiveVariables: 7, minFunctionLines: 0 });

    // Assert
    expect(livenessOnly(result).length).toBe(1);
  });

  it('analyzeVariableLifetime - nested function variables - inner vars do not inflate outer liveness', () => {
    // Arrange: outer has 2 vars (below threshold 7), inner has 8 vars (above threshold 7)
    const sourceText = [
      'function outerFn() {',
      '  const x = 1;',
      '  const y = 2;',
      '  function innerFn() {',
      '    const a = 1;',
      '    const b = 2;',
      '    const c = 3;',
      '    const d = 4;',
      '    const e = 5;',
      '    const f = 6;',
      '    const g = 7;',
      '    const h = 8;',
      filler(45, 'pad'),
      '    return a + b + c + d + e + f + g + h;',
      '  }',
      filler(40, 'outerPad'),
      '  return x + y + innerFn();',
      '}',
    ].join('\n');
    // Act
    const result = run(sourceText, { maxLifetimeLines: 999, maxLiveVariables: 7, minFunctionLines: 40 });
    // Assert: outer function must NOT have liveness-pressure (only 2 live vars)
    const outerPressure = livenessOnly(result).filter(f => f.maxLiveVariables <= 2);

    expect(outerPressure.length).toBe(0);
  });

  it('analyzeVariableLifetime - destructuring bindings all live simultaneously - emits liveness-pressure', () => {
    // Arrange: 8-binding destructuring + 50-line body; all bindings used at end → all simultaneously live
    const sourceText = [
      'function destructFn(obj: any) {',
      '  const { a, b, c, d, e, f, g, h } = obj;',
      filler(50, 'pad'),
      '  return a + b + c + d + e + f + g + h;',
      '}',
    ].join('\n');
    // Act
    const lp = selectAll(sourceText, livenessOnly, { maxLifetimeLines: 999, maxLiveVariables: 7, minFunctionLines: 10 });

    expect(lp.length).toBe(1);
    expect(lp[0]?.maxLiveVariables).toBeGreaterThanOrEqual(7);
  });

  it('analyzeVariableLifetime - for-loop inner vars combined with outer vars - emits liveness-pressure', () => {
    // Arrange: 5 outer vars declared before loop; inside loop, 3 more + use outer vars → 8 simultaneous
    const sourceText = [
      'function loopFn(items: number[]) {',
      '  const v1 = 1;',
      '  const v2 = 2;',
      '  const v3 = 3;',
      '  const v4 = 4;',
      '  const v5 = 5;',
      filler(45, 'pad'),
      '  for (let i = 0; i < items.length; i++) {',
      '    const inner1 = items[i]!;',
      '    const inner2 = inner1 * 2;',
      '    const inner3 = inner2 + 1;',
      '    console.log(inner3 + v1 + v2 + v3 + v4 + v5);',
      '  }',
      '}',
    ].join('\n');
    // Act
    const result = run(sourceText, { maxLifetimeLines: 999, maxLiveVariables: 7, minFunctionLines: 10 });

    // Assert
    expect(livenessOnly(result).length).toBe(1);
  });

  it('analyzeVariableLifetime - try-catch inner vars above threshold - emits liveness-pressure', () => {
    // Arrange: 5 vars outside + error + 2 vars inside catch → 8 live in catch block; threshold 7
    const sourceText = [
      'function tryCatchFn() {',
      '  const v1 = 1;',
      '  const v2 = 2;',
      '  const v3 = 3;',
      '  const v4 = 4;',
      '  const v5 = 5;',
      filler(45, 'pad'),
      '  try {',
      '    doWork(v1 + v2 + v3 + v4 + v5);',
      '  } catch (err: any) {',
      '    const msg = String(err);',
      '    const code = err.code ?? 0;',
      '    console.error(msg, code, v1, v2, v3, v4, v5);',
      '  }',
      '}',
    ].join('\n');
    // Act
    const result = run(sourceText, { maxLifetimeLines: 999, maxLiveVariables: 7, minFunctionLines: 10 });

    // Assert
    expect(livenessOnly(result).length).toBe(1);
  });

  it('analyzeVariableLifetime - if-branch declares all vars at top - all 8 live at entry block', () => {
    // Arrange: 8 vars declared at top, half used in if-branch, half in else-branch
    // At declaration point all 8 are simultaneously live → above threshold 7
    const sourceText = [
      'function branchFn(cond: boolean) {',
      '  const a = 1;',
      '  const b = 2;',
      '  const c = 3;',
      '  const d = 4;',
      '  const e = 5;',
      '  const f = 6;',
      '  const g = 7;',
      '  const h = 8;',
      filler(45, 'pad'),
      '  if (cond) {',
      '    return a + b + c + d;',
      '  } else {',
      '    return e + f + g + h;',
      '  }',
      '}',
    ].join('\n');
    // Act
    const lp = selectAll(sourceText, livenessOnly, { maxLifetimeLines: 999, maxLiveVariables: 7, minFunctionLines: 10 });

    expect(lp.length).toBe(1);
    expect(lp[0]?.maxLiveVariables).toBeGreaterThanOrEqual(7);
  });

  it('analyzeVariableLifetime - two functions independently measured - only high-pressure one fires', () => {
    // Arrange: functionA has 8 live vars (fires), functionB has 2 live vars (no fire)
    const sourceText = [
      eightLiveVarFn('highPressure'),
      'function lowPressure() {',
      '  const x = 1;',
      '  const y = 2;',
      filler(50, 'lp'),
      '  return x + y;',
      '}',
    ].join('\n');
    // Act
    const lp = selectAll(sourceText, livenessOnly, { maxLifetimeLines: 999, maxLiveVariables: 7, minFunctionLines: 10 });

    expect(lp.length).toBe(1);
    expect(lp[0]?.maxLiveVariables).toBeGreaterThanOrEqual(7);
  });

  it('analyzeVariableLifetime - no maxLiveVariables option - liveness-pressure never fires', () => {
    // Arrange: 50-line function with 8 simultaneously live vars; options omit maxLiveVariables/minFunctionLines
    const sourceText = eightLiveVarFn('bigFnNoOpt');
    // Act — only maxLifetimeLines provided; maxLiveVariables/minFunctionLines absent → Infinity defaults
    const result = run(sourceText, { maxLifetimeLines: 999 });

    // Assert — no liveness-pressure finding because Infinity threshold is never reached
    expect(livenessOnly(result).length).toBe(0);
  });

  it('analyzeVariableLifetime - liveness-pressure hotSpotLine - points to correct line in source', () => {
    // Arrange: 50+ line function with 8 vars declared at top, all used in return
    // hotSpotLine must be > 0 and <= last line of function
    const varDecls = [
      '  const a = 1;',
      '  const b = 2;',
      '  const c = 3;',
      '  const d = 4;',
      '  const e = 5;',
      '  const f = 6;',
      '  const g = 7;',
      '  const h = 8;',
    ];
    const lines = ['function hotSpotFn() {', ...varDecls, filler(45, 'pad'), '  return a + b + c + d + e + f + g + h;', '}'];
    const sourceText = lines.join('\n');
    const functionLastLine = lines.length;
    // Act
    const lp = selectAll(sourceText, livenessOnly, { maxLifetimeLines: 999, maxLiveVariables: 7, minFunctionLines: 40 });

    // Assert
    expect(lp.length).toBe(1);
    expect(lp[0]!.hotSpotLine).toBeGreaterThan(0);
    expect(lp[0]!.hotSpotLine).toBeLessThanOrEqual(functionLastLine);
  });

  it('analyzeVariableLifetime - let reassignment kills previous def - does not inflate live count beyond actual simultaneous uses', () => {
    // Arrange: x reassigned unconditionally; at most x+a alive simultaneously (count=2), threshold 3 → no fire
    const sourceText = [
      'function f() {',
      '  let x = 1;',
      '  const a = 2;',
      '  console.log(x + a);',
      '  x = 99;',
      filler(50, 'pad'),
      '  return x;',
      '}',
    ].join('\n');
    // Act
    const result = run(sourceText, { maxLifetimeLines: 999, maxLiveVariables: 3, minFunctionLines: 40 });

    // Assert: maxLiveCount is 2 (x + a), which is below threshold 3 → no liveness-pressure
    expect(livenessOnly(result).length).toBe(0);
  });

  it('analyzeVariableLifetime - class method with many live vars - emits liveness-pressure', () => {
    // Arrange: 50+ line class method with 8 vars all used in return
    const sourceText = [
      'class Service {',
      '  process() {',
      '    const a = 1;',
      '    const b = 2;',
      '    const c = 3;',
      '    const d = 4;',
      '    const e = 5;',
      '    const f = 6;',
      '    const g = 7;',
      '    const h = 8;',
      filler(45, 'pad')
        .split('\n')
        .map(l => '  ' + l)
        .join('\n'),
      '    return a + b + c + d + e + f + g + h;',
      '  }',
      '}',
    ].join('\n');
    // Act
    const lp = selectAll(sourceText, livenessOnly, { maxLifetimeLines: 999, maxLiveVariables: 7, minFunctionLines: 40 });

    // Assert
    expect(lp.length).toBe(1);
    expect(lp[0]!.maxLiveVariables).toBeGreaterThanOrEqual(7);
  });

  it('analyzeVariableLifetime - two functions both exceeding threshold - emits two liveness-pressure findings', () => {
    // Arrange: functionA and functionB each have 8 vars all alive simultaneously, threshold 7
    const sourceText = [eightLiveVarFn('functionA'), eightLiveVarFn('functionB')].join('\n');
    // Act
    const result = run(sourceText, { maxLifetimeLines: 999, maxLiveVariables: 7, minFunctionLines: 40 });

    // Assert: both functions emit liveness-pressure
    expect(livenessOnly(result).length).toBe(2);
  });

  // ── mutation-density ──

  it('analyzeVariableLifetime - maxMutationCount not set - no mutation-density findings', () => {
    // Arrange
    const sourceText = [
      'function f() {',
      '  let x = 0;',
      '  x = 1;',
      '  x = 2;',
      '  x = 3;',
      '  x = 4;',
      '  return x;',
      '}',
    ].join('\n');
    // Act
    const result = run(sourceText, { maxLifetimeLines: 999 });

    // Assert
    expect(mutationOnly(result).length).toBe(0);
  });

  it('analyzeVariableLifetime - mutations exceed maxMutationCount - emits finding', () => {
    // Arrange
    const sourceText = [
      'function f() {',
      '  let x = 0;',
      '  x = 1;',
      '  x = 2;',
      '  x = 3;',
      '  x = 4;',
      '  return x;',
      '}',
    ].join('\n');
    // Act
    const mutations = selectAll(sourceText, mutationOnly, { maxLifetimeLines: 999, maxMutationCount: 3 });

    // Assert
    expect(mutations.length).toBe(1);
    expect(mutations[0]!.variable).toBe('x');
    expect(mutations[0]!.mutationCount).toBe(4);
  });

  it('analyzeVariableLifetime - mutations equal maxMutationCount - no finding (strict greater-than)', () => {
    // Arrange
    const sourceText = ['function f() {', '  let x = 0;', '  x = 1;', '  x = 2;', '  x = 3;', '  return x;', '}'].join('\n');
    // Act
    const result = run(sourceText, { maxLifetimeLines: 999, maxMutationCount: 3 });

    // Assert
    expect(mutationOnly(result).length).toBe(0);
  });

  it('analyzeVariableLifetime - loop accumulator compound-assignment - suppressed', () => {
    // Arrange
    const sourceText = [
      'function f(items: number[]) {',
      '  let sum = 0;',
      '  for (const item of items) {',
      '    sum += item;',
      '  }',
      '  return sum;',
      '}',
    ].join('\n');
    // Act
    const result = run(sourceText, { maxLifetimeLines: 999, maxMutationCount: 0 });

    // Assert — sum += item inside loop is suppressed
    expect(mutationOnly(result).length).toBe(0);
  });

  it('analyzeVariableLifetime - multiple variables only exceeding ones reported', () => {
    // Arrange
    const sourceText = [
      'function f() {',
      '  let a = 0;',
      '  a = 1;',
      '  a = 2;',
      '  let b = 0;',
      '  b = 1;',
      '  return a + b;',
      '}',
    ].join('\n');
    // Act — threshold 1: a has 2 writes (exceeds), b has 1 write (equal, no finding)
    const mutations = selectAll(sourceText, mutationOnly, { maxLifetimeLines: 999, maxMutationCount: 1 });

    // Assert
    expect(mutations.length).toBe(1);
    expect(mutations[0]!.variable).toBe('a');
  });

  it('analyzeVariableLifetime - for-statement update clause i++ - suppressed as loop write', () => {
    // Arrange — i++ in update clause should be treated as loop write
    const sourceText = ['function f(n: number) {', '  for (let i = 0; i < n; i++) {', '    console.log(i);', '  }', '}'].join(
      '\n',
    );
    // Act — threshold 0 means any non-loop write triggers finding
    const result = run(sourceText, { maxLifetimeLines: 999, maxMutationCount: 0 });

    // Assert — i++ is inside ForStatement range, suppressed
    expect(mutationOnly(result).length).toBe(0);
  });
});
