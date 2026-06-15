import { describe, expect, it } from 'bun:test';

import { createOxcFingerprintNormalized } from './oxc-fingerprint';
import { parseSource } from './parse-source';

/**
 * Helper: parse two code snippets and check that their normalized fingerprints are equal.
 */
const expectSameNormalized = (codeA: string, codeB: string): void => {
  const a = parseSource('/virtual/norm/a.ts', codeA);
  const b = parseSource('/virtual/norm/b.ts', codeB);
  const fa = createOxcFingerprintNormalized(a.program);
  const fb = createOxcFingerprintNormalized(b.program);

  expect(fa).toBe(fb);
};

/**
 * Helper: parse two code snippets and check that their normalized fingerprints differ.
 */
const expectDifferentNormalized = (codeA: string, codeB: string): void => {
  const a = parseSource('/virtual/norm/a.ts', codeA);
  const b = parseSource('/virtual/norm/b.ts', codeB);
  const fa = createOxcFingerprintNormalized(a.program);
  const fb = createOxcFingerprintNormalized(b.program);

  expect(fa).not.toBe(fb);
};

describe('engine/ast/ast-normalizer', () => {
  describe('rule 1: if/else → ternary normalization', () => {
    it('should normalize if/else returning values to ternary', () => {
      // Arrange / Act / Assert
      expectSameNormalized(
        'export function f(c) { if (c) { return 1; } else { return 2; } }',
        'export function f(c) { return c ? 1 : 2; }',
      );
    });

    it('should normalize if/else assignment to conditional assignment', () => {
      expectSameNormalized(
        'export function f(c) { let x; if (c) { x = 1; } else { x = 2; } return x; }',
        'export function f(c) { let x; x = c ? 1 : 2; return x; }',
      );
    });
  });

  describe('rule 2: for → while normalization', () => {
    it('should normalize for loop to while loop', () => {
      expectSameNormalized(
        'export function f(n) { for (let i = 0; i < n; i++) { console.log(i); } }',
        'export function f(n) { let i = 0; while (i < n) { console.log(i); i++; } }',
      );
    });

    it('should NOT normalize for-loop with continue (semantics differ)', () => {
      // for-loop: continue runs the update; manual while equivalent must explicitly run it.
      // Appending update to the body unconditionally changes meaning when continue is present
      // (continue would skip the appended update → semantically different / infinite loop).
      expectDifferentNormalized(
        'export function f(n) { for (let i = 0; i < n; i++) { if (i % 2 === 0) continue; console.log(i); } }',
        'export function f(n) { let i = 0; while (i < n) { if (i % 2 === 0) continue; console.log(i); i++; } }',
      );
    });

    it('should still normalize for-loop when continue is inside a NESTED loop only', () => {
      // The continue here targets the inner loop, not the outer for; outer for is safe to normalize.
      expectSameNormalized(
        'export function f(n) { for (let i = 0; i < n; i++) { for (let j = 0; j < 3; j++) { if (j === 1) continue; } } }',
        'export function f(n) { let i = 0; while (i < n) { for (let j = 0; j < 3; j++) { if (j === 1) continue; } i++; } }',
      );
    });
  });

  describe('rule 3: template literal → concatenation normalization', () => {
    it('should normalize template literal to string concatenation', () => {
      expectSameNormalized('export function f(a) { return `${a} world`; }', 'export function f(a) { return a + " world"; }');
    });
  });

  describe('rule 4: optional chaining → conditional normalization', () => {
    it('should normalize optional chaining member access', () => {
      expectSameNormalized(
        'export function f(a) { return a?.b; }',
        'export function f(a) { return a != null ? a.b : undefined; }',
      );
    });
  });

  describe('rule 5: De Morgan normalization', () => {
    it('should normalize !(a && b) to !a || !b', () => {
      expectSameNormalized('export function f(a, b) { return !(a && b); }', 'export function f(a, b) { return !a || !b; }');
    });

    it('should normalize !(a || b) to !a && !b', () => {
      expectSameNormalized('export function f(a, b) { return !(a || b); }', 'export function f(a, b) { return !a && !b; }');
    });
  });

  describe('rule 6: forEach → for-of normalization', () => {
    it('should normalize arr.forEach to for-of', () => {
      expectSameNormalized(
        'export function f(arr) { arr.forEach((x) => { console.log(x); }); }',
        'export function f(arr) { for (const x of arr) { console.log(x); } }',
      );
    });

    it('should not normalize forEach with early return (break semantics differ)', () => {
      expectDifferentNormalized(
        'export function f(arr) { arr.forEach((x) => { if (x) return; console.log(x); }); }',
        'export function f(arr) { for (const x of arr) { if (x) return; console.log(x); } }',
      );
    });
  });

  describe('rule 7: map/filter(Boolean) normalization', () => {
    it('should normalize arr.map(fn).filter(Boolean) to equivalent form', () => {
      const codeA = 'export function f(arr) { return arr.map((x) => x.value).filter(Boolean); }';
      const codeB = 'export function g(items) { return items.map((item) => item.value).filter(Boolean); }';

      expectSameNormalized(codeA, codeB);
    });
  });

  describe('rule 8: ternary inversion normalization', () => {
    it('should normalize !x ? A : B to x ? B : A', () => {
      expectSameNormalized('export function f(x) { return !x ? 1 : 2; }', 'export function f(x) { return x ? 2 : 1; }');
    });
  });

  describe('non-equivalent code', () => {
    it('should not normalize semantically different code', () => {
      expectDifferentNormalized('export function f(a) { return a + 1; }', 'export function f(a) { return a - 1; }');
    });
  });
  // ── 말미 무조건 return; 정규화 (#16, 함수 끝 fall-off와 동일) ──
  it('should treat a trailing value-less return as equivalent to falling off the function', () => {
    expectSameNormalized('function f() { a(); b(); return; }', 'function g() { a(); b(); }');
  });

  it('should NOT strip a value-carrying trailing return', () => {
    expectDifferentNormalized('function f() { a(); return 1; }', 'function g() { a(); }');
  });

  it('should NOT strip a non-terminal (mid-body) return', () => {
    expectDifferentNormalized(
      'function f(c: boolean) { if (c) return; work(); }',
      'function g(c: boolean) { if (c) {} work(); }',
    );
  });
});
