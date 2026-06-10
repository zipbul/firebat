import type { Node } from 'oxc-parser';

import { describe, expect, it } from 'bun:test';

import { collectOxcNodes } from './oxc-ast-utils';
import { createOxcFingerprintExact, createOxcFingerprintShape } from './oxc-fingerprint';
import { parseSource } from './parse-source';

const shapeOfFirstFunction = (source: string): string => {
  const parsed = parseSource('/virtual/fp.ts', source);
  const fn = collectOxcNodes(parsed.program, (n: Node) => n.type === 'FunctionDeclaration')[0]!;

  return createOxcFingerprintShape(fn);
};

describe('engine/ast/oxc-fingerprint', () => {
  it('should not collide when literal tokens contain "|" characters', () => {
    // Arrange
    const a = parseSource('/virtual/fingerprint/a.ts', ['export function f() {', '  return g("a|b", "c");', '}'].join('\n'));
    const b = parseSource('/virtual/fingerprint/b.ts', ['export function f() {', '  return g("a", "b|c");', '}'].join('\n'));
    // Act
    const fa = createOxcFingerprintExact(a.program);
    const fb = createOxcFingerprintExact(b.program);

    // Assert
    expect(fa).not.toBe(fb);
  });

  it('should produce the same fingerprint regardless of parenthesization', () => {
    // Arrange — parens carry no semantic meaning; `(a + b)` and `a + b` are equivalent
    const a = parseSource('/virtual/fingerprint/paren-a.ts', ['export function f() {', '  return (a + b);', '}'].join('\n'));
    const b = parseSource('/virtual/fingerprint/paren-b.ts', ['export function f() {', '  return a + b;', '}'].join('\n'));
    // Act
    const fa = createOxcFingerprintExact(a.program);
    const fb = createOxcFingerprintExact(b.program);

    // Assert
    expect(fa).toBe(fb);
  });

  it('should produce the same shape fingerprint regardless of nested parens', () => {
    // Arrange — multiple paren layers should also unwrap transparently
    const a = parseSource(
      '/virtual/fingerprint/paren-shape-a.ts',
      ['export function f(x) {', '  return ((x + 1) * 2);', '}'].join('\n'),
    );
    const b = parseSource(
      '/virtual/fingerprint/paren-shape-b.ts',
      ['export function f(x) {', '  return (x + 1) * 2;', '}'].join('\n'),
    );
    // Act
    const fa = createOxcFingerprintShape(a.program);
    const fb = createOxcFingerprintShape(b.program);

    // Assert
    expect(fa).toBe(fb);
  });

  it('should produce the same shape fingerprint when identifier names differ', () => {
    // Arrange
    const a = parseSource(
      '/virtual/fingerprint/shape-a.ts',
      ['export function f(alpha) {', '  const x = alpha + 1;', '  return x;', '}'].join('\n'),
    );
    const b = parseSource(
      '/virtual/fingerprint/shape-b.ts',
      ['export function f(beta) {', '  const x = beta + 1;', '  return x;', '}'].join('\n'),
    );
    // Act
    const fa = createOxcFingerprintShape(a.program);
    const fb = createOxcFingerprintShape(b.program);

    // Assert
    expect(fa).toBe(fb);
  });

  it('should merge bound-identifier renames at the function level', () => {
    // 비교 단위 내부 바인딩(파라미터·지역)만 치환 → rename-only는 같은 정규형
    expect(shapeOfFirstFunction('function f(p) { return p + 1; }')).toBe(shapeOfFirstFunction('function f(q) { return q + 1; }'));
  });

  it('should NOT merge when a member property name differs even if it collides with a binding name', () => {
    // obj.p / obj.q 의 p·q는 프로퍼티 이름(참조 아님) → 치환 금지 → 다른 정규형
    expect(shapeOfFirstFunction('function f(p) { return obj.p; }')).not.toBe(
      shapeOfFirstFunction('function f(q) { return obj.q; }'),
    );
  });

  it('should NOT merge when a free identifier (callee) differs', () => {
    // 자유 식별자(외부 함수)는 다른 결정 → 치환 금지 → 다른 정규형
    expect(shapeOfFirstFunction('function f(x) { return alpha(x); }')).not.toBe(
      shapeOfFirstFunction('function f(x) { return beta(x); }'),
    );
  });

  it('should NOT merge when an object-literal key differs', () => {
    expect(shapeOfFirstFunction('function f(p) { return { p: 1 }; }')).not.toBe(
      shapeOfFirstFunction('function f(q) { return { q: 1 }; }'),
    );
  });
});
