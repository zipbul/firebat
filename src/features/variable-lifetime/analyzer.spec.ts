import { describe, expect, it } from 'bun:test';

import type { ScopeNarrowingFinding, VariableLifetimeFinding } from '../../types';

import { parseSource } from '../../engine/ast/parse-source';
import { analyzeVariableLifetime, createEmptyVariableLifetime, __testing__ } from './analyzer';

const { isPureInitializer } = __testing__;

const lifetimeOnly = (
  findings: ReadonlyArray<VariableLifetimeFinding | ScopeNarrowingFinding>,
): ReadonlyArray<VariableLifetimeFinding> => findings.filter((f): f is VariableLifetimeFinding => f.kind === 'variable-lifetime');

const scopeOnly = (
  findings: ReadonlyArray<VariableLifetimeFinding | ScopeNarrowingFinding>,
): ReadonlyArray<ScopeNarrowingFinding> => findings.filter((f): f is ScopeNarrowingFinding => f.kind === 'scope-narrowing');

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
    const lt = lifetimeOnly(result);

    expect(lt.length).toBeGreaterThanOrEqual(1);
    expect(lt[0]?.lifetimeLines).toBeGreaterThan(2);
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
    const lt = lifetimeOnly(result);

    expect(lt.filter(f => f.variable === 'x').length).toBe(1);
    expect(lt[0]?.lifetimeLines).toBe(1);
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
    const xFindings = lifetimeOnly(result).filter(f => f.variable === 'x');

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
    const xFindings = lifetimeOnly(result).filter(f => f.variable === 'x');

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
    const paramFindings = lifetimeOnly(result).filter(f => f.variable === 'param');

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
    const sourceText = ['function f() {', '  const unused = 42;', filler(6, 'pad'), '  return 1;', '}'].join('\n');
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
    expect(result.filter(f => f.variable === 'a').length).toBe(1);
    expect(result.filter(f => f.variable === 'b').length).toBe(1);
    expect(result.filter(f => f.variable === 'a')[0]?.file).toBe('src/a.ts');
    expect(result.filter(f => f.variable === 'b')[0]?.file).toBe('src/b.ts');
  });

  // ── scope-narrowing ───────────────────────────────────────────────────────────

  describe('isPureInitializer', () => {
    const parse = (expr: string) => {
      const src = `function f() { const x = ${expr}; }`;
      const parsed = parseSource('/p/a.ts', src);
      // Navigate: Program -> body[0] (FunctionDeclaration) -> body -> body[0] (VariableDeclaration) -> declarations[0] -> init
      const fnDecl = (parsed.program as any).body[0];
      const varDecl = fnDecl.body.body[0];
      const init = varDecl.declarations[0].init;

      return init;
    };

    it('isPureInitializer - numeric literal - returns true', () => {
      // Arrange
      const node = parse('1');
      // Act + Assert
      expect(isPureInitializer(node)).toBe(true);
    });

    it('isPureInitializer - string literal - returns true', () => {
      // Arrange
      const node = parse('"hello"');
      // Act + Assert
      expect(isPureInitializer(node)).toBe(true);
    });

    it('isPureInitializer - identifier reference - returns true', () => {
      // Arrange
      const node = parse('someVar');
      // Act + Assert
      expect(isPureInitializer(node)).toBe(true);
    });

    it('isPureInitializer - binary expression with pure operands - returns true', () => {
      // Arrange
      const node = parse('a + b');
      // Act + Assert
      expect(isPureInitializer(node)).toBe(true);
    });

    it('isPureInitializer - conditional expression with pure operands - returns true', () => {
      // Arrange
      const node = parse('cond ? 1 : 2');
      // Act + Assert
      expect(isPureInitializer(node)).toBe(true);
    });

    it('isPureInitializer - null initializer (no init) - returns true', () => {
      // Arrange: null represents no initializer
      // Act + Assert
      expect(isPureInitializer(null)).toBe(true);
    });

    it('isPureInitializer - call expression - returns false', () => {
      // Arrange
      const node = parse('compute()');
      // Act + Assert
      expect(isPureInitializer(node)).toBe(false);
    });

    it('isPureInitializer - new expression - returns false', () => {
      // Arrange
      const node = parse('new Foo()');
      // Act + Assert
      expect(isPureInitializer(node)).toBe(false);
    });

    it('isPureInitializer - spread in array - returns false', () => {
      // Arrange
      const node = parse('[...arr]');
      // Act + Assert
      expect(isPureInitializer(node)).toBe(false);
    });
  });

  describe('analyzeVariableLifetime - scope-narrowing', () => {
    // ── 탐지: 순수 초기화 ──

    it('analyzeVariableLifetime - const literal used only in if-consequent - detects scope-narrowing', () => {
      // Arrange
      const sourceText = 'function f(cond: boolean) { const x = 1; if (cond) { use(x); } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      // Assert
      const finding = scopeOnly(result).find(f => f.variable === 'x');

      expect(finding).toBeDefined();
      expect(finding!.kind).toBe('scope-narrowing');
      expect((finding as any).targetBlock.type).toBe('if-consequent');
    });

    it('analyzeVariableLifetime - const pure binary used only in if-consequent - detects scope-narrowing', () => {
      // Arrange
      const sourceText = 'function f(a: number, b: number, cond: boolean) { const x = a + b; if (cond) { use(x); } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      // Assert
      const finding = scopeOnly(result).find(f => f.variable === 'x');

      expect(finding).toBeDefined();
      expect((finding as any).targetBlock.type).toBe('if-consequent');
    });

    it('analyzeVariableLifetime - let no initializer used only in if-block - detects scope-narrowing', () => {
      // Arrange
      const sourceText = 'function f(cond: boolean) { let x; if (cond) { x = 1; use(x); } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      // Assert
      const finding = scopeOnly(result).find(f => f.variable === 'x');

      expect(finding).toBeDefined();
    });

    it('analyzeVariableLifetime - const used only in if-alternate block - detects scope-narrowing', () => {
      // Arrange
      const sourceText = 'function f(a: boolean) { const x = 1; if (a) { } else { use(x); } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      // Assert
      const finding = scopeOnly(result).find(f => f.variable === 'x');

      expect(finding).toBeDefined();
      expect((finding as any).targetBlock.type).toBe('if-alternate');
    });

    it('analyzeVariableLifetime - const used only in try-block - detects scope-narrowing', () => {
      // Arrange
      const sourceText = 'function f() { const x = 1; try { use(x); } catch (e) { } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      // Assert
      const finding = scopeOnly(result).find(f => f.variable === 'x');

      expect(finding).toBeDefined();
      expect((finding as any).targetBlock.type).toBe('try-block');
    });

    it('analyzeVariableLifetime - const used only in catch-block - detects scope-narrowing', () => {
      // Arrange
      const sourceText = 'function f() { const x = 1; try { } catch (e) { use(x); } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      // Assert
      const finding = scopeOnly(result).find(f => f.variable === 'x');

      expect(finding).toBeDefined();
      expect((finding as any).targetBlock.type).toBe('catch-block');
    });

    it('analyzeVariableLifetime - const used only in single switch case - detects scope-narrowing', () => {
      // Arrange
      const sourceText = 'function f(y: string) { const x = 1; switch (y) { case "a": use(x); break; } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      // Assert
      const finding = scopeOnly(result).find(f => f.variable === 'x');

      expect(finding).toBeDefined();
      expect((finding as any).targetBlock.type).toBe('switch-case');
    });

    // ── 제외: 불순 초기화 ──

    it('analyzeVariableLifetime - call expression initializer - no scope-narrowing finding', () => {
      // Arrange
      const sourceText = 'function f(cond: boolean) { const x = compute(); if (cond) { use(x); } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      // Assert
      expect(scopeOnly(result).filter(f => f.variable === 'x').length).toBe(0);
    });

    it('analyzeVariableLifetime - new expression initializer - no scope-narrowing finding', () => {
      // Arrange
      const sourceText = 'function f(cond: boolean) { const x = new Foo(); if (cond) { use(x); } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      // Assert
      expect(scopeOnly(result).filter(f => f.variable === 'x').length).toBe(0);
    });

    it('analyzeVariableLifetime - spread initializer - no scope-narrowing finding', () => {
      // Arrange
      const sourceText = 'function f(arr: number[], cond: boolean) { const x = [...arr]; if (cond) { use(x); } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      // Assert
      expect(scopeOnly(result).filter(f => f.variable === 'x').length).toBe(0);
    });

    // ── 제외: 블록 밖 사용 ──

    it('analyzeVariableLifetime - variable used outside block - no scope-narrowing finding', () => {
      // Arrange
      const sourceText = 'function f(cond: boolean) { const x = 1; use(x); if (cond) { use(x); } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      // Assert
      expect(scopeOnly(result).filter(f => f.variable === 'x').length).toBe(0);
    });

    it('analyzeVariableLifetime - variable used in if-condition - no scope-narrowing finding', () => {
      // Arrange
      const sourceText = 'function f() { const x = 1; if (x > 0) { doSomething(); } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      // Assert
      expect(scopeOnly(result).filter(f => f.variable === 'x').length).toBe(0);
    });

    it('analyzeVariableLifetime - variable used in both if-consequent and alternate - no scope-narrowing finding', () => {
      // Arrange
      const sourceText = 'function f(a: boolean) { const x = 1; if (a) { use(x); } else { use(x); } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      // Assert
      expect(scopeOnly(result).filter(f => f.variable === 'x').length).toBe(0);
    });

    it('analyzeVariableLifetime - var declaration - no scope-narrowing finding', () => {
      // Arrange
      const sourceText = 'function f(cond: boolean) { var x = 1; if (cond) { use(x); } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      // Assert
      expect(scopeOnly(result).filter(f => f.variable === 'x').length).toBe(0);
    });

    it('analyzeVariableLifetime - else-if chain (alternate is IfStatement) - no scope-narrowing finding', () => {
      // Arrange
      const sourceText = 'function f(a: boolean, b: boolean) { const x = 1; if (a) { } else if (b) { use(x); } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      // Assert
      expect(scopeOnly(result).filter(f => f.variable === 'x').length).toBe(0);
    });

    it('analyzeVariableLifetime - variable used in loop body - no scope-narrowing finding', () => {
      // Arrange
      const sourceText = 'function f(items: number[]) { const x = 1; for (const item of items) { use(x); } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      // Assert
      expect(scopeOnly(result).filter(f => f.variable === 'x').length).toBe(0);
    });

    // ── 제외: switch fall-through ──

    it('analyzeVariableLifetime - switch with fall-through case - no scope-narrowing finding', () => {
      // Arrange
      const sourceText = 'function f(y: string) { const x = 1; switch (y) { case "a": use(x); case "b": break; } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      // Assert
      expect(scopeOnly(result).filter(f => f.variable === 'x').length).toBe(0);
    });

    it('analyzeVariableLifetime - switch with variable in multiple cases - no scope-narrowing finding', () => {
      // Arrange
      const sourceText =
        'function f(y: string) { const x = 1; switch (y) { case "a": use(x); break; case "b": use(x); break; } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      // Assert
      expect(scopeOnly(result).filter(f => f.variable === 'x').length).toBe(0);
    });

    // ── 제외: finally/catch 안전성 ──

    it('analyzeVariableLifetime - variable used in finally block - no scope-narrowing finding', () => {
      // Arrange
      const sourceText = 'function f() { let x = null; try { x = 1; } finally { cleanup(x); } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      // Assert
      expect(scopeOnly(result).filter(f => f.variable === 'x').length).toBe(0);
    });

    it('analyzeVariableLifetime - variable used in both try and catch blocks - no scope-narrowing finding', () => {
      // Arrange
      const sourceText = 'function f() { let x = null; try { x = 1; use(x); } catch (e) { log(x); } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      // Assert
      expect(scopeOnly(result).filter(f => f.variable === 'x').length).toBe(0);
    });

    // ── 제외: intervening write ──

    it('analyzeVariableLifetime - intervening write to referenced var - no scope-narrowing finding', () => {
      // Arrange
      const sourceText =
        'function f(cond: boolean) { let otherVar = 1; const x = otherVar; otherVar = 999; if (cond) { use(x); } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      // Assert
      expect(scopeOnly(result).filter(f => f.variable === 'x').length).toBe(0);
    });

    it('analyzeVariableLifetime - no intervening write (function call only) - detects scope-narrowing', () => {
      // Arrange: doSomething() is a call but does not directly write otherVar — FN한계, but direct write absent means safe
      const sourceText =
        'function f(cond: boolean, otherVar: number) { const x = otherVar; doSomething(); if (cond) { use(x); } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      // Assert
      const finding = scopeOnly(result).find(f => f.variable === 'x');

      expect(finding).toBeDefined();
    });

    // ── Finding 형태 검증 ──

    it('analyzeVariableLifetime - scope-narrowing finding - has all required fields', () => {
      // Arrange
      const sourceText = 'function f(cond: boolean) { const target = 42; if (cond) { use(target); } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      // Assert
      const finding = scopeOnly(result).find(f => f.variable === 'target');

      expect(finding).toBeDefined();
      expect(finding!.kind).toBe('scope-narrowing');
      expect(finding!.file).toBe('src/a.ts');
      expect(finding!.variable).toBe('target');
      expect(finding!.span).toBeDefined();
      expect(finding!.span.start.line).toBeGreaterThan(0);
      expect((finding as any).targetBlock).toBeDefined();
      expect((finding as any).targetBlock.type).toBe('if-consequent');
      expect((finding as any).targetBlock.span).toBeDefined();
    });
  });

  // ── 엣지케이스 공격 시나리오 (attack scenarios) ────────────────────────────

  describe('analyzeVariableLifetime - edge case attack scenarios', () => {
    // 시나리오 1: 빈 함수 — 크래시하지 않는가?
    it('analyzeVariableLifetime - completely empty function body - does not crash', () => {
      // Arrange
      const sourceText = 'function foo() {}';
      const files = [file('src/a.ts', sourceText)];
      // Act
      let threw = false;
      let result: any;

      try {
        result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 0 });
      } catch {
        threw = true;
      }

      // Assert
      expect(threw).toBe(false);
      expect(result.length).toBe(0);
    });

    // 시나리오 2: 선언만 있고 사용 없음 — 크래시하지 않는가?
    it('analyzeVariableLifetime - declared but never used variable - does not crash', () => {
      // Arrange
      const sourceText = 'function foo() { const x = 1; }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      let threw = false;
      let result: any;

      try {
        result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 0 });
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
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      const findings = scopeOnly(result).filter(f => f.variable === 'x');

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
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      const findings = scopeOnly(result).filter(f => f.variable === 'x');

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
      const files = [file('src/a.ts', sourceText)];
      const start = Date.now();
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      const elapsed = Date.now() - start;

      // Assert — must complete in under 5 seconds
      expect(elapsed).toBeLessThan(5000);
      const findings = scopeOnly(result).filter(f => f.variable === 'x');

      expect(findings.length).toBe(1);
    });

    // 시나리오 6: switch default case — default도 case로 처리하는가?
    it('analyzeVariableLifetime - switch with default case terminating - detects scope-narrowing', () => {
      // Arrange — switch has case "a" + default, both with break
      const sourceText =
        'function f(y: string) { const x = 1; switch (y) { case "a": break; default: use(x); break; } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      const findings = scopeOnly(result).filter(f => f.variable === 'x');

      // Assert — x used only in default case, which is a switch-case block
      expect(findings.length).toBe(1);
      expect(findings[0]!.targetBlock.type).toBe('switch-case');
    });

    // 시나리오 7a: try-catch-finally — try에서만 사용
    it('analyzeVariableLifetime - try-catch-finally: variable used only in try block - detects scope-narrowing', () => {
      // Arrange
      const sourceText = 'function f() { const x = 1; try { use(x); } catch (e) { } finally { cleanup(); } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      const findings = scopeOnly(result).filter(f => f.variable === 'x');

      // Assert — x only in try block; finalizer has no x usage, so should detect
      expect(findings.length).toBe(1);
      expect(findings[0]!.targetBlock.type).toBe('try-block');
    });

    // 시나리오 7b: try-catch-finally — catch에서만 사용
    it('analyzeVariableLifetime - try-catch-finally: variable used only in catch block - detects scope-narrowing', () => {
      // Arrange
      const sourceText = 'function f() { const x = 1; try { } catch (e) { use(x); } finally { cleanup(); } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      const findings = scopeOnly(result).filter(f => f.variable === 'x');

      // Assert — x only in catch block; finalizer has no x usage, so should detect
      expect(findings.length).toBe(1);
      expect(findings[0]!.targetBlock.type).toBe('catch-block');
    });

    // 시나리오 7c: try-catch-finally — finally에서만 사용
    it('analyzeVariableLifetime - try-catch-finally: variable used only in finally block - no scope-narrowing finding', () => {
      // Arrange — variable used in finally: excluded by finalizer rule
      const sourceText = 'function f() { const x = 1; try { } catch (e) { } finally { use(x); } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });
      const findings = scopeOnly(result).filter(f => f.variable === 'x');

      // Assert — finally usage blocks scope-narrowing detection
      expect(findings.length).toBe(0);
    });

    // 시나리오 8: ObjectExpression computed key — impure로 판별하는가?
    it('isPureInitializer - object with computed key - returns false', () => {
      // Arrange: { [compute()]: 1 } — computed key is a call expression → impure
      const parse = (expr: string) => {
        const src = `function f() { const x = ${expr}; }`;
        const parsed = parseSource('/p/a.ts', src);
        const fnDecl = (parsed.program as any).body[0];
        const varDecl = fnDecl.body.body[0];

        return varDecl.declarations[0].init;
      };

      const node = parse('{ [compute()]: 1 }');
      // Act
      const result = isPureInitializer(node);

      // Assert — computed key contains call expression, should be impure
      expect(result).toBe(false);
    });

    it('analyzeVariableLifetime - object with computed key initializer - no scope-narrowing finding', () => {
      // Arrange
      const sourceText =
        'function f(cond: boolean) { const x = { [compute()]: 1 }; if (cond) { use(x); } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });

      // Assert — computed key is impure → no scope-narrowing
      expect(scopeOnly(result).filter(f => f.variable === 'x').length).toBe(0);
    });

    // 시나리오 9: SequenceExpression — impure로 판별하는가?
    it('isPureInitializer - sequence expression - returns false', () => {
      // Arrange: parse `(a, b)` as SequenceExpression via comma operator
      // oxc parses `(a, b)` in variable initializer as SequenceExpression
      const parse = (expr: string) => {
        const src = `function f() { const x = ${expr}; }`;
        const parsed = parseSource('/p/a.ts', src);
        const fnDecl = (parsed.program as any).body[0];
        const varDecl = fnDecl.body.body[0];

        return varDecl.declarations[0].init;
      };

      const node = parse('(a, b)');
      // Act + Assert
      expect(isPureInitializer(node)).toBe(false);
    });

    it('analyzeVariableLifetime - sequence expression initializer - no scope-narrowing finding', () => {
      // Arrange
      const sourceText = 'function f(cond: boolean) { const x = (a, b); if (cond) { use(x); } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });

      // Assert — sequence expression is impure → no scope-narrowing
      expect(scopeOnly(result).filter(f => f.variable === 'x').length).toBe(0);
    });

    // 시나리오 10: ArrowFunctionExpression in initializer — 함수 정의 자체는?
    it('isPureInitializer - arrow function expression - unknown type treated as impure', () => {
      // Arrange: `const x = () => 1` — ArrowFunctionExpression as initializer
      const parse = (expr: string) => {
        const src = `function f() { const x = ${expr}; }`;
        const parsed = parseSource('/p/a.ts', src);
        const fnDecl = (parsed.program as any).body[0];
        const varDecl = fnDecl.body.body[0];

        return varDecl.declarations[0].init;
      };

      const node = parse('() => 1');
      // Act
      const result = isPureInitializer(node);

      // Assert — ArrowFunctionExpression is not in the pure list, treated as impure (conservative)
      expect(result).toBe(false);
    });

    it('analyzeVariableLifetime - arrow function initializer used only in if-block - no scope-narrowing finding', () => {
      // Arrange: const x = () => 1; — arrow fn def is impure (conservative)
      const sourceText = 'function f(cond: boolean) { const x = () => 1; if (cond) { x(); } }';
      const files = [file('src/a.ts', sourceText)];
      // Act
      const result = analyzeVariableLifetime(files as any, { maxLifetimeLines: 999 });

      // Assert — arrow function initializer is impure → no scope-narrowing
      expect(scopeOnly(result).filter(f => f.variable === 'x').length).toBe(0);
    });
  });
});
