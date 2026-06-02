import { describe, expect, it } from 'bun:test';

import type { ParsedFile } from './types';

import { parseSource } from './ast/parse-source';
import { detectWasteOxc } from './waste-detector-oxc';

const toFile = (filePath: string, code: string): ParsedFile => parseSource(filePath, code) as ParsedFile;

describe('engine/waste-detector-oxc — detectWasteOxc', () => {
  it('returns empty array for non-array input (guard)', () => {
    const result = detectWasteOxc(null as unknown as ParsedFile[]);

    expect(result).toEqual([]);
  });

  it('returns empty array for empty files list', () => {
    expect(detectWasteOxc([])).toEqual([]);
  });

  it('skips files with parse errors', () => {
    const badFile: ParsedFile = {
      filePath: '/bad.ts',
      program: {} as never,
      errors: [{ message: 'err' }] as never as [],
      comments: [],
      sourceText: 'const x = ;',
      module: {} as never,
    };
    const result = detectWasteOxc([badFile]);

    expect(result).toEqual([]);
  });

  it('returns empty array for file with no wasted variables', () => {
    const f = toFile(
      '/clean.ts',
      `
      function add(a: number, b: number): number {
        return a + b;
      }
    `,
    );
    const result = detectWasteOxc([f]);

    expect(result).toEqual([]);
  });

  it('does NOT report use-zero variable (CLAUDE.md: no-unused-vars 영역 비대상)', () => {
    // A binding with zero syntactic reads belongs to no-unused-vars (tsc noUnusedLocals
    // already flags it), not waste. Waste only reports dead writes of bindings that are
    // actually read somewhere.
    const f = toFile(
      '/unused.ts',
      `
      function foo() {
        const unused = 42;
        return 1;
      }
    `,
    );
    const result = detectWasteOxc([f]);

    expect(result.some(r => r.label === 'unused')).toBe(false);
  });

  it('detects dead write (variable written then immediately overwritten)', () => {
    const f = toFile(
      '/dead.ts',
      `
      function compute() {
        let x;
        x = 1;
        x = 2;
        return x;
      }
    `,
    );
    const result = detectWasteOxc([f]);

    expect(result.some(r => r.label === 'x')).toBe(true);
  });

  it('findings have required shape: kind, filePath, span, evidence', () => {
    const f = toFile(
      '/shape.ts',
      `
      function waste() {
        const dead = 10;
        const dead2 = dead + 1;
        dead2;
        const unreachable = 99;
        return 0;
      }
    `,
    );
    const result = detectWasteOxc([f]);

    for (const finding of result) {
      expect(typeof finding.kind).toBe('string');
      expect(typeof finding.filePath).toBe('string');
      expect(finding.span).toBeDefined();
      expect(typeof finding.span.start.line).toBe('number');
    }
  });

  it('processes multiple files in one call', () => {
    const f1 = toFile('/a.ts', 'function a(x: number) { return x; }');
    const f2 = toFile('/b.ts', 'function b(y: number) { return y; }');
    const result = detectWasteOxc([f1, f2]);

    expect(Array.isArray(result)).toBe(true);
  });

  // Bug 1: CFG try/catch exception edge 누락
  it('detectWasteOxc - variable used only in catch after mid-try exception - should not report dead-store', () => {
    // Arrange
    const source = `function f() {
      let x = getResource();
      try {
        mayThrow();
        x = transform(x);
      } catch {
        release(x);
      }
    }`;
    const f = toFile('/try-catch.ts', source);
    // Act
    const result = detectWasteOxc([f]);

    // Assert
    expect(result.some(r => r.kind === 'dead-store' && r.label === 'x')).toBe(false);
  });

  // Bug 2: localIndexByName.size===0 early return이 중첩 함수 방문을 차단
  it('detectWasteOxc - outer function with no locals - nested function still analyzed', () => {
    // The outer function having no locals must not short-circuit nested-function analysis.
    // `dead` is use=0 → no-unused-vars 영역, but the nested function must still be visited
    // so that real dead writes (case 1) would surface. Here we assert no FP escapes from
    // a use=0 binding inside the nested function.
    const source = `function outer() {
      function inner() {
        let v = 1;
        v = 2;
        return v;
      }
      return inner();
    }`;
    const f = toFile('/nested.ts', source);
    // Act
    const result = detectWasteOxc([f]);

    // Assert — the dead `v = 1` initializer (overwritten before read) is detected in the nested fn
    expect(result.some(r => r.label === 'v' && (r.kind === 'dead-store' || r.kind === 'dead-store-overwrite'))).toBe(true);
  });

  // Bug 3: ObjectPattern RestElement write 누락
  it('detectWasteOxc - rest sibling destructuring with object literal - rest variable used - should not report dead-store', () => {
    // Arrange
    const source = `function f() {
      const { a, ...rest } = { a: 1, b: 2, c: 3 };
      return rest;
    }`;
    const f = toFile('/rest-sibling.ts', source);
    // Act
    const result = detectWasteOxc([f]);

    // Assert
    expect(result.some(r => r.kind === 'dead-store' && r.label === 'rest')).toBe(false);
  });

  // Bug 5: switch case test 표현식 CFG 노드 추가
  it('detectWasteOxc - variable read only in switch case test - should not report dead-store', () => {
    // Arrange
    const source = `function f(x: string) {
      const target = 'hello';
      switch (x) {
        case target:
          return 'found';
      }
      return 'not found';
    }`;
    const f = toFile('/switch-case-test.ts', source);
    // Act
    const result = detectWasteOxc([f]);

    // Assert
    expect(result.some(r => r.kind === 'dead-store' && r.label === 'target')).toBe(false);
  });

  // Bug 6: ?? 연산자 short-circuit 모델링 — non-nullish left는 right를 평가하지 않음
  it('detectWasteOxc - variable read only in never-evaluated right of ?? - should report dead-store', () => {
    // Arrange
    const source = `function f() {
      const fallback = 99;
      const x = 1 ?? fallback;
      return x;
    }`;
    const f = toFile('/nullish-never.ts', source);
    // Act
    const result = detectWasteOxc([f]);

    // Assert
    expect(result.some(r => r.kind === 'dead-store' && r.label === 'fallback')).toBe(true);
  });

  it('detectWasteOxc - variable read in evaluated right of ?? with null left - should not report dead-store', () => {
    // Arrange
    const source = `function f() {
      const fallback = 99;
      const x = null ?? fallback;
      return x;
    }`;
    const f = toFile('/nullish-eval.ts', source);
    // Act
    const result = detectWasteOxc([f]);

    // Assert
    expect(result.some(r => r.kind === 'dead-store' && r.label === 'fallback')).toBe(false);
  });

  it('detectWasteOxc - try { throw } finally { read x } - no FP on x', () => {
    // Arrange — `x` is read inside finally. Even when the try block throws (and there
    // is no catch), finally must run, so the read is reachable. Previously the CFG
    // sent throws directly to exit, bypassing finally.
    const source = `function f() {
      let x = 1;
      try { throw new Error('boom'); }
      finally { console.log(x); }
    }`;
    const f = toFile('/try-finally-read.ts', source);
    // Act
    const result = detectWasteOxc([f]);

    // Assert
    expect(result.some(r => r.kind === 'dead-store' && r.label === 'x')).toBe(false);
  });

  it('detectWasteOxc - try { throw } catch(e) { read x } - no FP on x', () => {
    // Arrange — `x` is read inside catch. Previously the CFG sent every throw straight
    // to function exit (ignoring the active catch entry), so catch-body reads were
    // invisible to the dataflow and `let x = 1` was wrongly flagged as dead.
    const source = `function f() {
      let x = 1;
      try { throw new Error('boom'); }
      catch (e) { console.log(x); }
    }`;
    const f = toFile('/try-catch-read.ts', source);
    // Act
    const result = detectWasteOxc([f]);

    // Assert
    expect(result.some(r => r.kind === 'dead-store' && r.label === 'x')).toBe(false);
  });

  it('detectWasteOxc - outer let shadowed by inner block let - outer is use=0 (no-unused-vars 영역)', () => {
    // Outer `let x = 1` is never syntactically read (the inner block declares its own
    // `x` that shadows it). Use=0 belongs to no-unused-vars per CLAUDE.md, not waste.
    // tsc's `noUnusedLocals` already reports this.
    const source = `function f() { let x = 1; { let x = 2; console.log(x); } }`;
    const f = toFile('/shadow.ts', source);
    // Act
    const result = detectWasteOxc([f]);
    // Assert — waste does not flag the outer `x` (it's use=0, no-unused-vars territory)
    const outerXFindings = result.filter(r => r.label === 'x');

    // Inner `x = 2` is read inside the block, so the inner binding is not waste either.
    expect(outerXFindings.length).toBe(0);
  });

  it('detectWasteOxc - let declared and reassigned in same scope - not flagged', () => {
    // Arrange — control: `let x; ... x = 1; ... console.log(x);` is the legit
    // declaration-then-reassign pattern. The filter must still spare it.
    const source = `function f() { let x; x = 1; console.log(x); }`;
    const f = toFile('/declare-reassign.ts', source);
    // Act
    const result = detectWasteOxc([f]);

    // Assert — no dead-store on declaration
    expect(result.some(r => r.kind === 'dead-store' && r.label === 'x')).toBe(false);
  });

  it('detectWasteOxc - sequence expression with consecutive writes - earlier write is dead', () => {
    // Arrange — `(x=1, x=2)` writes x twice; the first is overwritten before any read.
    // Previously the CFG node held both writes in gen, so both propagated forward and
    // the read at `console.log(x)` "used" both, hiding the dead first write.
    const source = `function f() { let x; (x = 1, x = 2); console.log(x); }`;
    const f = toFile('/seq-write.ts', source);
    // Act
    const result = detectWasteOxc([f]);

    // Assert — x = 1 should be flagged as dead (overwritten by x = 2)
    expect(result.some(r => r.label === 'x')).toBe(true);
  });

  it('detectWasteOxc - parameter default expression references another param - no FP', () => {
    // Arrange — `b = a` reads `a`. Previously `a` was flagged as dead-store because
    // the default expression isn't part of the function body CFG.
    const source = `function f(a = 1, b = a) { console.log(b); }`;
    const f = toFile('/param-default.ts', source);
    // Act
    const result = detectWasteOxc([f]);

    // Assert
    expect(result.some(r => r.kind === 'dead-store' && r.label === 'a')).toBe(false);
  });

  it('detectWasteOxc - unused parameter - no FP (function parameter is out of scope per CLAUDE.md)', () => {
    // Arrange — function parameters are explicitly excluded by CLAUDE.md ("비대상: 함수 파라미터"),
    // so the detector must not report them regardless of underscore prefix.
    const sourceWithUnderscore = `function f(_unused) { return 1; }`;
    const sourceWithoutUnderscore = `function g(unused) { return 1; }`;
    const f1 = toFile('/param-unused-1.ts', sourceWithUnderscore);
    const f2 = toFile('/param-unused-2.ts', sourceWithoutUnderscore);
    // Act
    const r1 = detectWasteOxc([f1]);
    const r2 = detectWasteOxc([f2]);

    // Assert
    expect(r1.some(r => r.kind === 'dead-store' && r.label === '_unused')).toBe(false);
    expect(r2.some(r => r.kind === 'dead-store' && r.label === 'unused')).toBe(false);
  });

  it('detectWasteOxc - try{read} finally{write} - emits dead-store exactly once for finally write', () => {
    // Arrange — CFG models finally for both normal and abnormal completion paths,
    // which previously caused the finally `x=2` dead-store to be emitted twice.
    const source = `function f() {
      let x = 1;
      try { console.log(x); }
      finally { x = 2; }
    }`;
    const f = toFile('/try-finally-dup.ts', source);
    // Act
    const result = detectWasteOxc([f]);
    // Assert — exactly one dead-store finding for x
    const xFindings = result.filter(r => r.kind === 'dead-store' && r.label === 'x');

    expect(xFindings).toHaveLength(1);
  });

  // optional chain on literal null — RHS computed property never evaluates at runtime
  it('detectWasteOxc - literal null?.[x] computed access - should report dead-store for x', () => {
    // Arrange — `null?.[x]` short-circuits, so x is never actually read.
    const source = `function f() {
      const x = 1;
      null?.[x];
    }`;
    const f = toFile('/null-optional.ts', source);
    // Act
    const result = detectWasteOxc([f]);

    // Assert
    expect(result.some(r => r.kind === 'dead-store' && r.label === 'x')).toBe(true);
  });

  it('detectWasteOxc - obj?.[x] (non-null base) - should NOT report dead-store for x', () => {
    // Arrange — base is a real variable; x is genuinely read.
    const source = `function f(obj: any) {
      const x = 1;
      return obj?.[x];
    }`;
    const f = toFile('/obj-optional.ts', source);
    // Act
    const result = detectWasteOxc([f]);

    // Assert — control case
    expect(result.some(r => r.kind === 'dead-store' && r.label === 'x')).toBe(false);
  });

  // Bug 7: for-of 기존 변수 대입 write 추적
  // Bug 8: IIFE 내부 변수가 외부 함수 locals로 잘못 등록되어 false dead-store 발생
  it('detectWasteOxc - IIFE with inner variable - should not report IIFE-internal variable as dead-store', () => {
    // Arrange
    const source = `function outer() {
      (function inner() { const x = getX(); console.log(x); })();
    }`;
    const f = toFile('/iife-inner.ts', source);
    // Act
    const result = detectWasteOxc([f]);

    // Assert — x belongs to inner, not outer; outer has no dead-store
    expect(result.some(r => r.kind === 'dead-store' && r.label === 'x')).toBe(false);
  });

  it('detectWasteOxc - async arrow IIFE with inner variable - should not report IIFE-internal variable as dead-store', () => {
    // Arrange
    const source = `const getOrmDb = async () => {
      const created = (async () => { const x = getX(); return x; })();
      return created;
    };`;
    const f = toFile('/async-iife.ts', source);
    // Act
    const result = detectWasteOxc([f]);

    // Assert — x belongs to async IIFE, not outer; created is used
    expect(result.some(r => r.kind === 'dead-store' && r.label === 'x')).toBe(false);
    expect(result.some(r => r.kind === 'dead-store' && r.label === 'created')).toBe(false);
  });

  it('detectWasteOxc - sync IIFE overwrite makes earlier initializer dead', () => {
    const source = `function f() {
      let x = 1;
      (() => { x = 2; })();
      return x;
    }`;
    const result = detectWasteOxc([toFile('/sync-iife-overwrite.ts', source)]);

    expect(result.some(r => r.label === 'x')).toBe(true);
  });

  it('detectWasteOxc - throwing call inside inlined IIFE keeps pre-IIFE value live for catch', () => {
    const source = `function f() {
      let x = 1;
      try {
        (() => { g(); x = 2; })();
      } catch {
        return x;
      }
      return x;
    }`;
    const result = detectWasteOxc([toFile('/sync-iife-throw-catch.ts', source)]);

    expect(result.some(r => r.label === 'x')).toBe(false);
  });

  it('detectWasteOxc - assignment-level sync IIFE is inlined before outer declaration write', () => {
    const source = `function f() {
      let x = 1;
      const r = (() => { x = 2; return x; })();
      return r;
    }`;
    const result = detectWasteOxc([toFile('/sync-iife-assignment-result.ts', source)]);

    expect(result.some(r => r.label === 'x')).toBe(true);
    expect(result.some(r => r.label === 'r')).toBe(false);
  });

  it('detectWasteOxc - compound dead read with coercion risk does not unblock prior def', () => {
    const source = `function f() {
      let x = { valueOf() { fx(); return 1; } };
      x += 1;
      x = 5;
      return x;
    }`;
    const result = detectWasteOxc([toFile('/compound-coercion.ts', source)]);

    expect(result.some(r => r.label === 'x')).toBe(false);
  });

  it('detectWasteOxc - compound dead read with call RHS does not unblock prior def', () => {
    const source = `function f() {
      let x = 1;
      x += f();
      x = 5;
      return x;
    }`;
    const result = detectWasteOxc([toFile('/compound-call.ts', source)]);

    expect(result.some(r => r.label === 'x')).toBe(false);
  });

  it('detectWasteOxc - closure capture keeps overwritten def live', () => {
    const source = `function f() {
      let x = 1;
      const c = () => x;
      x = 2;
      c();
    }`;
    const result = detectWasteOxc([toFile('/closure-capture.ts', source)]);

    expect(result.some(r => r.label === 'x')).toBe(false);
  });

  it('detectWasteOxc - simple overwrite chain reports prior def', () => {
    const source = `function f() {
      let x = 1;
      x = 2;
      return x;
    }`;
    const result = detectWasteOxc([toFile('/simple-overwrite-chain.ts', source)]);

    expect(result.some(r => r.label === 'x')).toBe(true);
  });

  it('detectWasteOxc - dead side-effect-free compound read unblocks prior def', () => {
    const source = `function f() {
      let x = 1;
      x += 2;
      x = 5;
      return x;
    }`;
    const result = detectWasteOxc([toFile('/compound-safe-chain.ts', source)]);

    expect(result.filter(r => r.label === 'x')).toHaveLength(1);
  });

  it('detectWasteOxc - existing variable assigned in for-of and used after loop - should not report dead-store', () => {
    // Arrange
    const source = `function f(items: number[]) {
      let current = 0;
      for (current of items) {
        process(current);
      }
      return current;
    }`;
    const f = toFile('/for-of-existing.ts', source);
    // Act
    const result = detectWasteOxc([f]);

    // Assert
    expect(result.some(r => r.kind === 'dead-store' && r.label === 'current')).toBe(false);
  });

  it('detectWasteOxc - parameter x and inner block shadow let x - distinct bindings, neither falsely flagged', () => {
    // Regression catch for the prior name-only varIndex bug: outer param `x` and inner
    // `let x = 1` must be tracked as distinct bindings. The inner `x` has use=0 →
    // no-unused-vars 영역 (waste does not report). The outer `x` is read at return.
    // Neither belongs to waste.
    const source = `function f(x: number) {
      {
        let x = 1;
      }
      return x;
    }`;
    const f = toFile('/param-inner-shadow.ts', source);
    const result = detectWasteOxc([f]);

    expect(result.length).toBe(0);
  });

  // ── redundant-binding W/K boundary locks (concept-aligned; pin the inline-vs-keep edges) ──
  const isRb = (label: string) => (r: { kind: string; label: string }) => r.kind === 'redundant-binding' && r.label === label;

  it('redundant-binding - bare-literal single-use - NOT flagged (information-preservation; name is sole documentation)', () => {
    const f = toFile('/lit.ts', 'const FLAG = 0x3ffc;\nexport function f(x: number) { return x & FLAG; }');

    expect(detectWasteOxc([f]).some(isRb('FLAG'))).toBe(false);
  });

  it('redundant-binding - computed-arith single-use - flagged W (expression self-documents)', () => {
    const f = toFile('/arith.ts', 'export function f(x: number) { const y = 1 + 1; return x * y; }');

    expect(detectWasteOxc([f]).some(isRb('y'))).toBe(true);
  });

  it('redundant-binding - `as const` RHS single-use - NOT flagged', () => {
    const f = toFile('/asconst.ts', 'export function f() { const x = [1, 2] as const; return x.length; }');

    expect(detectWasteOxc([f]).some(isRb('x'))).toBe(false);
  });

  it('redundant-binding - `satisfies` object RHS single-use - NOT flagged', () => {
    const f = toFile('/sat.ts', 'export function f() { const o = { a: 1 } satisfies Record<string, number>; return o.a; }');

    expect(detectWasteOxc([f]).some(isRb('o'))).toBe(false);
  });

  it('redundant-binding - non-null `!` member RHS single-use - flagged W', () => {
    const f = toFile('/nonnull.ts', 'export function f(obj: { a?: number }) { const v = obj.a!; return v + 1; }');

    expect(detectWasteOxc([f]).some(isRb('v'))).toBe(true);
  });

  it('redundant-binding - optional-chain RHS single-use - NOT flagged (branch-dependent, conservative)', () => {
    const f = toFile('/optchain.ts', 'export function f(obj?: { a: number }) { const a = obj?.a; return a; }');

    expect(detectWasteOxc([f]).some(isRb('a'))).toBe(false);
  });
});
