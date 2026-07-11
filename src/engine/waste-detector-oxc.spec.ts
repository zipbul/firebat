import { describe, expect, it } from 'bun:test';

import type { ParsedFile } from './types';

import { expectSpanShape, parseFileAs as toFile } from '../../test/integration/shared/test-kit';
import { detectWasteOxc } from './waste-detector-oxc';

interface DeadStoreCase {
  name: string;
  file: string;
  source: string;
  label: string;
  reported: boolean;
}

interface RedundantBindingCase {
  name: string;
  file: string;
  source: string;
  label: string;
  flagged: boolean;
}

/** Assert `detectWasteOxc(files)` reports no findings. */
const expectNoWaste = (files: ParsedFile[]): void => {
  expect(detectWasteOxc(files)).toEqual([]);
};

/** Predicate: a finding is a dead-store for the variable named `label`. */
const isDeadStore =
  (label: string) =>
  (r: { readonly kind: string; readonly label: string }): boolean =>
    r.kind === 'dead-store' && r.label === label;

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

    expectNoWaste([badFile]);
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

    expectNoWaste([f]);
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
      expectSpanShape(finding);
    }
  });

  it('processes multiple files in one call', () => {
    const f1 = toFile('/a.ts', 'function a(x: number) { return x; }');
    const f2 = toFile('/b.ts', 'function b(y: number) { return y; }');
    const result = detectWasteOxc([f1, f2]);

    expect(Array.isArray(result)).toBe(true);
  });

  // ── dead-store W/K cases: source → detectWasteOxc → assert one (kind:'dead-store', label) presence ──
  // Each row keeps its distinct input + expected presence. Bug-fix provenance noted in `name`.
  const deadStoreCases: DeadStoreCase[] = [
    {
      // Bug 1: CFG try/catch exception edge 누락
      name: 'variable used only in catch after mid-try exception - should not report dead-store',
      file: '/try-catch.ts',
      source: `function f() {
      let x = getResource();
      try {
        mayThrow();
        x = transform(x);
      } catch {
        release(x);
      }
    }`,
      label: 'x',
      reported: false,
    },
    {
      // Bug 3: ObjectPattern RestElement write 누락
      name: 'rest sibling destructuring with object literal - rest variable used - should not report dead-store',
      file: '/rest-sibling.ts',
      source: `function f() {
      const { a, ...rest } = { a: 1, b: 2, c: 3 };
      return rest;
    }`,
      label: 'rest',
      reported: false,
    },
    {
      // Bug 5: switch case test 표현식 CFG 노드 추가
      name: 'variable read only in switch case test - should not report dead-store',
      file: '/switch-case-test.ts',
      source: `function f(x: string) {
      const target = 'hello';
      switch (x) {
        case target:
          return 'found';
      }
      return 'not found';
    }`,
      label: 'target',
      reported: false,
    },
    {
      // Bug 6: ?? 연산자 short-circuit 모델링 — non-nullish left는 right를 평가하지 않음
      name: 'variable read only in never-evaluated right of ?? - should report dead-store',
      file: '/nullish-never.ts',
      source: `function f() {
      const fallback = 99;
      const x = 1 ?? fallback;
      return x;
    }`,
      label: 'fallback',
      reported: true,
    },
    {
      name: 'variable read in evaluated right of ?? with null left - should not report dead-store',
      file: '/nullish-eval.ts',
      source: `function f() {
      const fallback = 99;
      const x = null ?? fallback;
      return x;
    }`,
      label: 'fallback',
      reported: false,
    },
    {
      // `x` is read inside finally. Even when the try block throws (and there is no
      // catch), finally must run, so the read is reachable. Previously the CFG sent
      // throws directly to exit, bypassing finally.
      name: 'try { throw } finally { read x } - no FP on x',
      file: '/try-finally-read.ts',
      source: `function f() {
      let x = 1;
      try { throw new Error('boom'); }
      finally { console.log(x); }
    }`,
      label: 'x',
      reported: false,
    },
    {
      // `x` is read inside catch. Previously the CFG sent every throw straight to
      // function exit (ignoring the active catch entry), so catch-body reads were
      // invisible to the dataflow and `let x = 1` was wrongly flagged as dead.
      name: 'try { throw } catch(e) { read x } - no FP on x',
      file: '/try-catch-read.ts',
      source: `function f() {
      let x = 1;
      try { throw new Error('boom'); }
      catch (e) { console.log(x); }
    }`,
      label: 'x',
      reported: false,
    },
    {
      // base is a real variable; x is genuinely read.
      name: 'obj?.[x] (non-null base) - should NOT report dead-store for x',
      file: '/obj-optional.ts',
      source: `function f(obj: any) {
      const x = 1;
      return obj?.[x];
    }`,
      label: 'x',
      reported: false,
    },
    {
      // `null?.[x]` short-circuits, so x is never actually read.
      name: 'literal null?.[x] computed access - should report dead-store for x',
      file: '/null-optional.ts',
      source: `function f() {
      const x = 1;
      null?.[x];
    }`,
      label: 'x',
      reported: true,
    },
    {
      // `b = a` reads `a`. Previously `a` was flagged as dead-store because the default
      // expression isn't part of the function body CFG.
      name: 'parameter default expression references another param - no FP',
      file: '/param-default.ts',
      source: `function f(a = 1, b = a) { console.log(b); }`,
      label: 'a',
      reported: false,
    },
    {
      // let declared then reassigned in same scope — legit declaration-then-reassign.
      name: 'let declared and reassigned in same scope - not flagged',
      file: '/declare-reassign.ts',
      source: `function f() { let x; x = 1; console.log(x); }`,
      label: 'x',
      reported: false,
    },
    {
      // Bug 8: IIFE 내부 변수가 외부 함수 locals로 잘못 등록되어 false dead-store 발생
      name: 'IIFE with inner variable - should not report IIFE-internal variable as dead-store',
      file: '/iife-inner.ts',
      source: `function outer() {
      (function inner() { const x = getX(); console.log(x); })();
    }`,
      label: 'x',
      reported: false,
    },
    {
      // existing variable assigned in for-of and used after loop.
      name: 'existing variable assigned in for-of and used after loop - should not report dead-store',
      file: '/for-of-existing.ts',
      source: `function f(items: number[]) {
      let current = 0;
      for (current of items) {
        process(current);
      }
      return current;
    }`,
      label: 'current',
      reported: false,
    },
  ];

  it.each(deadStoreCases)('detectWasteOxc - $name', ({ file, source, label, reported }) => {
    const f = toFile(file, source);
    const result = detectWasteOxc([f]);

    expect(result.some(isDeadStore(label))).toBe(reported);
  });

  // ── overwrite/liveness cases: source → detectWasteOxc → assert (any-kind, label) presence ──
  const labelPresenceCases: DeadStoreCase[] = [
    {
      name: 'detects dead write (variable written then immediately overwritten)',
      file: '/dead.ts',
      source: `
      function compute() {
        let x;
        x = 1;
        x = 2;
        return x;
      }
    `,
      label: 'x',
      reported: true,
    },
    {
      // `(x=1, x=2)` writes x twice; the first is overwritten before any read.
      // Previously the CFG node held both writes in gen, so both propagated forward
      // and the read at `console.log(x)` "used" both, hiding the dead first write.
      name: 'sequence expression with consecutive writes - earlier write is dead',
      file: '/seq-write.ts',
      source: `function f() { let x; (x = 1, x = 2); console.log(x); }`,
      label: 'x',
      reported: true,
    },
    {
      name: 'sync IIFE overwrite makes earlier initializer dead',
      file: '/sync-iife-overwrite.ts',
      source: `function f() {
      let x = 1;
      (() => { x = 2; })();
      return x;
    }`,
      label: 'x',
      reported: true,
    },
    {
      name: 'throwing call inside inlined IIFE keeps pre-IIFE value live for catch',
      file: '/sync-iife-throw-catch.ts',
      source: `function f() {
      let x = 1;
      try {
        (() => { g(); x = 2; })();
      } catch {
        return x;
      }
      return x;
    }`,
      label: 'x',
      reported: false,
    },
    {
      name: 'compound dead read with coercion risk does not unblock prior def',
      file: '/compound-coercion.ts',
      source: `function f() {
      let x = { valueOf() { fx(); return 1; } };
      x += 1;
      x = 5;
      return x;
    }`,
      label: 'x',
      reported: false,
    },
    {
      name: 'compound dead read with call RHS does not unblock prior def',
      file: '/compound-call.ts',
      source: `function f() {
      let x = 1;
      x += f();
      x = 5;
      return x;
    }`,
      label: 'x',
      reported: false,
    },
    {
      name: 'closure capture keeps overwritten def live',
      file: '/closure-capture.ts',
      source: `function f() {
      let x = 1;
      const c = () => x;
      x = 2;
      c();
    }`,
      label: 'x',
      reported: false,
    },
    {
      name: 'simple overwrite chain reports prior def',
      file: '/simple-overwrite-chain.ts',
      source: `function f() {
      let x = 1;
      x = 2;
      return x;
    }`,
      label: 'x',
      reported: true,
    },
  ];

  it.each(labelPresenceCases)('detectWasteOxc - $name', ({ file, source, label, reported }) => {
    const result = detectWasteOxc([toFile(file, source)]);

    expect(result.some(r => r.label === label)).toBe(reported);
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
    expect(r1.some(isDeadStore('_unused'))).toBe(false);
    expect(r2.some(isDeadStore('unused'))).toBe(false);
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
    const xFindings = result.filter(isDeadStore('x'));

    expect(xFindings).toHaveLength(1);
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
    expect(result.some(isDeadStore('x'))).toBe(false);
    expect(result.some(isDeadStore('created'))).toBe(false);
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

  const redundantBindingCases: RedundantBindingCase[] = [
    {
      name: 'redundant-binding - bare-literal single-use - NOT flagged (information-preservation; name is sole documentation)',
      file: '/lit.ts',
      source: 'const FLAG = 0x3ffc;\nexport function f(x: number) { return x & FLAG; }',
      label: 'FLAG',
      flagged: false,
    },
    {
      name: 'redundant-binding - computed-arith single-use - flagged W (expression self-documents)',
      file: '/arith.ts',
      source: 'export function f(x: number) { const y = 1 + 1; return x * y; }',
      label: 'y',
      flagged: true,
    },
    {
      name: 'redundant-binding - `as const` RHS single-use - NOT flagged',
      file: '/asconst.ts',
      source: 'export function f() { const x = [1, 2] as const; return x.length; }',
      label: 'x',
      flagged: false,
    },
    {
      name: 'redundant-binding - `satisfies` object RHS single-use - NOT flagged',
      file: '/sat.ts',
      source: 'export function f() { const o = { a: 1 } satisfies Record<string, number>; return o.a; }',
      label: 'o',
      flagged: false,
    },
    {
      name: 'redundant-binding - non-null `!` member RHS single-use - flagged W',
      file: '/nonnull.ts',
      source: 'export function f(obj: { a?: number }) { const v = obj.a!; return v + 1; }',
      label: 'v',
      flagged: true,
    },
    {
      name: 'redundant-binding - optional-chain RHS single-use - NOT flagged (branch-dependent, conservative)',
      file: '/optchain.ts',
      source: 'export function f(obj?: { a: number }) { const a = obj?.a; return a; }',
      label: 'a',
      flagged: false,
    },
  ];

  it.each(redundantBindingCases)('$name', ({ file, source, label, flagged }) => {
    const f = toFile(file, source);

    expect(detectWasteOxc([f]).some(isRb(label))).toBe(flagged);
  });
});

// ── mutation-API(BUILTIN_TARGET_MUTATION_APIS) 경로 — 이전에 전혀 미테스트였던 브랜치 ──
//
// `Object.assign(v, …)` 류의 첫 인자를 'mutation'으로 분류하는 근거는 자유 식별자
// `Object`/`Reflect`가 전역 빌트인이라는 identity다. 파일이 같은 이름의 런타임 바인딩을
// 선언하면(import·변수 등) 그 identity가 닫히지 않으므로 mutation 분류를 보류한다
// (기본 'escape' 폴백 = 보수) — dead-store W를 만들지 않는다. 헌장: identity 미확인
// 이름 매칭은 K방향으로만. (수신자 메서드 매칭 v.push는 fresh 수신자가 identity를
// 닫아주므로 별개 — 이 게이트의 대상이 아니다.)
describe('engine/waste-detector-oxc — builtin target-mutation APIs (identity gate)', () => {
  it('reports dead-store for a fresh object mutated only via the global Object.assign (baseline W)', () => {
    const f = toFile(
      '/virtual/src/assign-baseline.ts',
      'export function f(data: Record<string, unknown>): void { const v = {}; Object.assign(v, data); }',
    );

    expect(detectWasteOxc([f]).some(isDeadStore('v'))).toBe(true);
  });

  it('holds when Object is shadowed by an import (custom assign may persist the target)', () => {
    const f = toFile(
      '/virtual/src/assign-shadow-import.ts',
      ['import { Object } from "./my-registry";', 'export function f(data: Record<string, unknown>): void { const v = {}; Object.assign(v, data); }'].join(
        '\n',
      ),
    );

    expect(detectWasteOxc([f]).some(isDeadStore('v'))).toBe(false);
  });

  it('holds when Object is shadowed by a local binding', () => {
    const f = toFile(
      '/virtual/src/assign-shadow-local.ts',
      [
        'declare const globalRegistry: { store(t: unknown, s: unknown): void };',
        'export function f(data: Record<string, unknown>): void {',
        '  const Object = { assign: (t: unknown, s: unknown) => globalRegistry.store(t, s) };',
        '  const v = {};',
        '  Object.assign(v, data);',
        '}',
      ].join('\n'),
    );

    expect(detectWasteOxc([f]).some(isDeadStore('v'))).toBe(false);
  });

  it('holds when Reflect is shadowed by an import (Reflect.set path)', () => {
    const f = toFile(
      '/virtual/src/reflect-shadow.ts',
      ['import { Reflect } from "./meta";', 'export function f(): void { const v = {}; Reflect.set(v, "k", 1); }'].join('\n'),
    );

    expect(detectWasteOxc([f]).some(isDeadStore('v'))).toBe(false);
  });

  it('still reports for the unshadowed Reflect.set (guard)', () => {
    const f = toFile('/virtual/src/reflect-baseline.ts', 'export function f(): void { const v = {}; Reflect.set(v, "k", 1); }');

    expect(detectWasteOxc([f]).some(isDeadStore('v'))).toBe(true);
  });

  it('does not treat an ambient declare as shadowing (no runtime binding)', () => {
    const f = toFile(
      '/virtual/src/assign-ambient.ts',
      ['declare const Object: ObjectConstructor;', 'export function f(data: Record<string, unknown>): void { const v = {}; Object.assign(v, data); }'].join(
        '\n',
      ),
    );

    expect(detectWasteOxc([f]).some(isDeadStore('v'))).toBe(true);
  });

  it('keeps a fresh-receiver method mutation unaffected by an unrelated Object shadow', () => {
    // v.push의 identity는 fresh [] 수신자가 닫는다 — Object 섀도잉과 무관하게 W 유지.
    const f = toFile(
      '/virtual/src/push-unrelated-shadow.ts',
      ['import { Object } from "./my-registry";', 'export function f(): void { const v: number[] = []; v.push(1); }'].join('\n'),
    );

    expect(detectWasteOxc([f]).some(isDeadStore('v'))).toBe(true);
  });

  it('holds when the file mutates globalThis.Object (member-write un-confirms the identity)', () => {
    const f = toFile(
      '/virtual/src/assign-globalthis-write.ts',
      [
        'declare const fake: ObjectConstructor;',
        '(globalThis as { Object: ObjectConstructor }).Object = fake;',
        'export function f(data: Record<string, unknown>): void { const v = {}; Object.assign(v, data); }',
      ].join('\n'),
    );

    expect(detectWasteOxc([f]).some(isDeadStore('v'))).toBe(false);
  });

  it('holds when the file mutates globalThis["Object"] via a computed string key', () => {
    const f = toFile(
      '/virtual/src/assign-computed-write.ts',
      [
        'declare const fake: ObjectConstructor;',
        '(globalThis as Record<string, unknown>)["Object"] = fake;',
        'export function f(data: Record<string, unknown>): void { const v = {}; Object.assign(v, data); }',
      ].join('\n'),
    );

    expect(detectWasteOxc([f]).some(isDeadStore('v'))).toBe(false);
  });

  it('holds when the file reassigns the bare global name (Object = fake)', () => {
    const f = toFile(
      '/virtual/src/assign-bare-write.ts',
      [
        'declare let Object: ObjectConstructor;',
        'declare const fake: ObjectConstructor;',
        'Object = fake;',
        'export function f(data: Record<string, unknown>): void { const v = {}; Object.assign(v, data); }',
      ].join('\n'),
    );

    expect(detectWasteOxc([f]).some(isDeadStore('v'))).toBe(false);
  });

  it('holds when Object is a function parameter name', () => {
    const f = toFile(
      '/virtual/src/assign-param-shadow.ts',
      'export function f(Object: { assign(t: unknown, s: unknown): void }, data: Record<string, unknown>): void { const v = {}; Object.assign(v, data); }',
    );

    expect(detectWasteOxc([f]).some(isDeadStore('v'))).toBe(false);
  });

  it('does NOT treat a type-only import as shadowing (no runtime binding)', () => {
    const f = toFile(
      '/virtual/src/assign-type-import.ts',
      ['import type { Object } from "./types";', 'export function f(data: Record<string, unknown>): void { const v = {}; Object.assign(v, data); }'].join(
        '\n',
      ),
    );

    expect(detectWasteOxc([f]).some(isDeadStore('v'))).toBe(true);
  });

  it('falls back to real when a non-target argument is impure (whole call must survive)', () => {
    const f = toFile(
      '/virtual/src/assign-impure-arg.ts',
      'export function f(make: () => Record<string, unknown>): void { const v = {}; Object.assign(v, make()); }',
    );

    expect(detectWasteOxc([f]).some(isDeadStore('v'))).toBe(false);
  });
});
