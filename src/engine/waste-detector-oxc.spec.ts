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

  it('detects unused variable (declared but never read)', () => {
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

    expect(result.some(r => r.kind === 'dead-store' && r.label === 'unused')).toBe(true);
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

    expect(result.some(r => r.kind === 'dead-store-overwrite' && r.label === 'x')).toBe(true);
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
  it('detectWasteOxc - outer function with no locals - should detect dead-store in nested function', () => {
    // Arrange
    const source = `function outer() {
      function inner() {
        const dead = 1;
        return 2;
      }
      return inner();
    }`;
    const f = toFile('/nested.ts', source);
    // Act
    const result = detectWasteOxc([f]);

    // Assert
    expect(result.some(r => r.kind === 'dead-store' && r.label === 'dead')).toBe(true);
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

  it('detectWasteOxc - unused parameter with no default reads - still no FP', () => {
    // Arrange — control: param without defaults, never read in body
    const source = `function f(_unused) { return 1; }`;
    const f = toFile('/param-unused.ts', source);
    // Act
    const result = detectWasteOxc([f]);

    // Assert — underscore-prefixed params are intentionally excluded by detector
    expect(result.some(r => r.kind === 'dead-store' && r.label === '_unused')).toBe(false);
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
});
