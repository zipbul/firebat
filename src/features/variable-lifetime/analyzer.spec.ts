import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../engine/ast/parse-source';
import { analyzeVariableLifetime, createEmptyVariableLifetime } from './analyzer';

const file = (relPath: string, sourceText: string) => parseSource(`/p/${relPath}`, sourceText);

const fileWithErrors = (relPath: string, sourceText: string) => {
  const parsed = file(relPath, sourceText);

  return { ...parsed, errors: [{ message: 'synthetic' }] as any };
};

const filler = (count: number, prefix = 'x') =>
  Array.from({ length: count }, (_, i) => `  const ${prefix}${i} = ${i};`).join('\n');

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

  it('analyzeVariableLifetime - non-ts file - skips file', () => {
    // Arrange
    const files = [file('src/a.js', 'function f() { const a = 1;\nreturn a; }')];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 0 });
    // Assert
    expect(result.length).toBe(0);
  });

  it('analyzeVariableLifetime - function with no local variables - no findings', () => {
    // Arrange
    const sourceText = 'function f() { return 1; }';
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 0 });
    // Assert
    expect(result.length).toBe(0);
  });

  it('analyzeVariableLifetime - empty function body - no findings', () => {
    // Arrange
    const sourceText = 'function f() {}';
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 0 });
    // Assert
    expect(result.length).toBe(0);
  });

  // ── 핵심 동작: 임계값 ──

  it('analyzeVariableLifetime - lifetime exceeds threshold - reports finding', () => {
    // Arrange
    const sourceText = ['function f() {', '  const x = 1;', filler(5), '  return x;', '}'].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 2 });
    // Assert
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]?.kind).toBe('variable-lifetime');
    expect(result[0]?.lifetimeLines).toBeGreaterThan(2);
  });

  it('analyzeVariableLifetime - lifetime within threshold - no finding', () => {
    // Arrange
    const sourceText = ['function f() {', '  const x = 1;', '  return x;', '}'].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 10 });
    // Assert
    expect(result.length).toBe(0);
  });

  it('analyzeVariableLifetime - negative maxLifetimeLines - clamps to 0', () => {
    // Arrange
    const sourceText = ['function f() {', '  const x = 1;', '  const a = 1;', '  return x;', '}'].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: -1 });
    // Assert
    expect(result.length).toBeGreaterThanOrEqual(1);
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
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 3 });
    // Assert — lifetime 3 === threshold 3, strictly greater required, so not reported
    expect(result.filter(f => f.variable === 'x').length).toBe(0);
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
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 3 });
    // Assert — lifetime 4 > threshold 3
    expect(result.filter(f => f.variable === 'x').length).toBe(1);
  });

  it('analyzeVariableLifetime - maxLifetimeLines 0 - single line gap reports', () => {
    // Arrange — x declared on line 2, used on line 3, lifetime = 1 > 0
    const sourceText = ['function f() {', '  const x = 1;', '  return x;', '}'].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 0 });
    // Assert
    expect(result.filter(f => f.variable === 'x').length).toBe(1);
    expect(result[0]?.lifetimeLines).toBe(1);
  });

  it('analyzeVariableLifetime - same line declaration and use - lifetime 0 not reported', () => {
    // Arrange — all on one line, lifetime = 0
    const sourceText = 'function f() { const x = 1; return x; }';
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 0 });
    // Assert — lifetime 0 is NOT > 0, so not reported
    expect(result.filter(f => f.variable === 'x').length).toBe(0);
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
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 5 });
    // Assert — x lifetime is 7 (line 2 to line 9), reported
    const xFindings = result.filter(f => f.variable === 'x');

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
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 5 });
    // Assert — lifetime = 2 (line 2 to line 4), within threshold
    expect(result.filter(f => f.variable === 'x').length).toBe(0);
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
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 2 });
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
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 5 });
    // Assert — neither x exceeds threshold (both have lifetime 1)
    expect(result.filter(f => f.variable === 'x').length).toBe(0);
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
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 5 });
    // Assert — x has no direct use in outer scope (only nested), so no finding
    expect(result.filter(f => f.variable === 'x').length).toBe(0);
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
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 5 });
    // Assert
    expect(result.filter(f => f.variable === 'x').length).toBe(0);
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
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 5 });
    // Assert — x used in both branches, the farther one determines lifetime
    expect(result.filter(f => f.variable === 'x').length).toBe(1);
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
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 5 });
    // Assert
    expect(result.filter(f => f.variable === 'multiplier').length).toBe(1);
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
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 5 });
    // Assert
    expect(result.filter(f => f.variable === 'resource').length).toBe(1);
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
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 5 });
    // Assert — only def2's lifetime counted, def1 is killed
    const xFindings = result.filter(f => f.variable === 'x');

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
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 5 });
    // Assert — two findings for x: def1 (longer lifetime) and def2 (shorter lifetime)
    const xFindings = result.filter(f => f.variable === 'x');

    expect(xFindings.length).toBe(2);
    // def1 has longer lifetime than def2
    const lifetimes = xFindings.map(f => f.lifetimeLines).sort((a, b) => b - a);

    expect(lifetimes[0]).toBeGreaterThan(lifetimes[1]!);
  });

  // ── 파라미터 / 구조분해 ──

  it('analyzeVariableLifetime - parameter - tracked from declaration line', () => {
    // Arrange
    const sourceText = [
      'function f(param: number) {', // line 1
      filler(6, 'pad'),
      '  return param;', // line 8
      '}',
    ].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 5 });
    // Assert
    const paramFindings = result.filter(f => f.variable === 'param');

    expect(paramFindings.length).toBe(1);
    expect(paramFindings[0]?.lifetimeLines).toBeGreaterThan(5);
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
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 5 });
    // Assert — both a and b reported
    expect(result.filter(f => f.variable === 'a').length).toBe(1);
    expect(result.filter(f => f.variable === 'b').length).toBe(1);
  });

  // ── 함수 종류 ──

  it('analyzeVariableLifetime - arrow function - analyzed', () => {
    // Arrange
    const sourceText = [
      'const f = () => {',
      '  const x = 1;', // line 2
      filler(6, 'pad'),
      '  return x;', // line 9
      '};',
    ].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 5 });
    // Assert
    expect(result.filter(f => f.variable === 'x').length).toBe(1);
  });

  it('analyzeVariableLifetime - function expression - analyzed', () => {
    // Arrange
    const sourceText = [
      'const f = function() {',
      '  const x = 1;', // line 2
      filler(6, 'pad'),
      '  return x;', // line 9
      '};',
    ].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 5 });
    // Assert
    expect(result.filter(f => f.variable === 'x').length).toBe(1);
  });

  // ── 사용 없는 변수 ──

  it('analyzeVariableLifetime - variable declared but never used - no finding', () => {
    // Arrange
    const sourceText = [
      'function f() {',
      '  const unused = 42;',
      filler(6, 'pad'),
      '  return 1;',
      '}',
    ].join('\n');
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 0 });
    // Assert — unused has no use, so no lastUseOffset → no finding
    expect(result.filter(f => f.variable === 'unused').length).toBe(0);
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
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 3 });
    // Assert
    const finding = result.find(f => f.variable === 'target');

    expect(finding).toBeDefined();
    expect(finding!.kind).toBe('variable-lifetime');
    expect(finding!.file).toBe('src/a.ts');
    expect(finding!.variable).toBe('target');
    expect(typeof finding!.lifetimeLines).toBe('number');
    expect(finding!.lifetimeLines).toBeGreaterThan(3);
    expect(typeof finding!.contextBurden).toBe('number');
    expect(finding!.contextBurden).toBeGreaterThanOrEqual(1);
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
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 3 });
    const finding = result.find(f => f.variable === 'x');
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
    const files = [file('src/a.ts', sourceText)];
    // Act
    const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 3 });
    // Assert
    const fnAFindings = result.filter(f => f.variable === 'x' || f.variable === 'y');
    const fnBFindings = result.filter(f => f.variable === 'z');

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
    expect(result.filter(f => f.variable === 'a').length).toBe(1);
    expect(result.filter(f => f.variable === 'b').length).toBe(1);
    expect(result.filter(f => f.variable === 'a')[0]?.file).toBe('src/a.ts');
    expect(result.filter(f => f.variable === 'b')[0]?.file).toBe('src/b.ts');
  });
});
