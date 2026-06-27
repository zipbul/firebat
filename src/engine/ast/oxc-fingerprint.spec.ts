import type { Node } from 'oxc-parser';

import { describe, expect, it } from 'bun:test';

import { collectOxcNodes } from './oxc-ast-utils';
import { createOxcFingerprintExact, createOxcFingerprintNormalized, createOxcFingerprintShape } from './oxc-fingerprint';
import { parseSource } from './parse-source';

interface DistinctContractCase {
  name: string;
  left: string;
  right: string;
}

const shapeOfFirstFunction = (source: string): string => {
  const parsed = parseSource('/virtual/fp.ts', source);
  const fn = collectOxcNodes(parsed.program, (n: Node) => n.type === 'FunctionDeclaration')[0]!;

  return createOxcFingerprintShape(fn);
};

/** Assert two parsed programs share the same shape fingerprint. */
const expectSameShape = (a: ReturnType<typeof parseSource>, b: ReturnType<typeof parseSource>): void => {
  expect(createOxcFingerprintShape(a.program)).toBe(createOxcFingerprintShape(b.program));
};

/** Exact fingerprint of the first FunctionDeclaration in `source` (virtual path is irrelevant). */
const exactOfFirstFunction = (source: string): string => {
  const parsed = parseSource('/v/fn.ts', source);
  const fn = collectOxcNodes(parsed.program, (n: Node) => n.type === 'FunctionDeclaration')[0]!;

  return createOxcFingerprintExact(fn);
};

const normalizedOfFirstInterface = (source: string): string => {
  const parsed = parseSource('/v/x.ts', source);
  const node = collectOxcNodes(parsed.program, (n: Node) => n.type === 'TSInterfaceDeclaration')[0]!;

  return createOxcFingerprintNormalized(node);
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
    // Assert
    expectSameShape(a, b);
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
    // Assert
    expectSameShape(a, b);
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

  it('should give an interface and a type alias with the same members one normalized fingerprint', () => {
    const iface = parseSource('/v/i.ts', 'interface X { id: string; active: boolean; }');
    const alias = parseSource('/v/t.ts', 'type X = { id: string; active: boolean; };');
    const ifaceNode = collectOxcNodes(iface.program, (n: Node) => n.type === 'TSInterfaceDeclaration')[0]!;
    const aliasNode = collectOxcNodes(alias.program, (n: Node) => n.type === 'TSTypeAliasDeclaration')[0]!;

    expect(createOxcFingerprintNormalized(ifaceNode)).toBe(createOxcFingerprintNormalized(aliasNode));
  });

  // Each row: two interface contracts that must normalize to DIFFERENT fingerprints
  // because the distinguishing modifier/order carries a real contract decision.
  const distinctContractCases: DistinctContractCase[] = [
    {
      name: 'differing only in an optional member',
      left: 'interface X { id?: string; }',
      right: 'interface X { id: string; }',
    },
    {
      name: 'differing only in a readonly member',
      left: 'interface X { readonly id: string; }',
      right: 'interface X { id: string; }',
    },
    {
      name: 'whose member order differs',
      left: 'interface X { x: number; y: number; }',
      right: 'interface X { y: number; x: number; }',
    },
  ];

  it.each(distinctContractCases)('should distinguish contracts $name', ({ left, right }) => {
    expect(normalizedOfFirstInterface(left)).not.toBe(normalizedOfFirstInterface(right));
  });
});

describe('createOxcFingerprint — regex literals', () => {
  // 함수명·구조 동일, 정규식 패턴만 다름 (isIdentStart vs isIdentPart 류).
  const startRx = 'function f(c: string) { return /[A-Za-z_$]/.test(c); }';
  const partRx = 'function f(c: string) { return /[A-Za-z0-9_$]/.test(c); }';

  it('distinguishes different regex literals at the exact tier (pattern is content)', () => {
    // 정규식 미인코딩 시 둘 다 동일해져 EXACT 오분류 — 패턴/flags를 인코딩해야 구별된다.
    expect(exactOfFirstFunction(startRx)).not.toBe(exactOfFirstFunction(partRx));
  });

  it('also distinguishes different regex literals at the shape tier (literals never substituted)', () => {
    // 리터럴은 어느 tier에서도 치환하지 않는다(내용=결정). 정규식만 다른 함수는 shape에서도
    // 정규형이 어긋나 매칭되지 않는다 — 모호한 literal-variant 비탐지(zero-FP).
    expect(shapeOfFirstFunction(startRx)).not.toBe(shapeOfFirstFunction(partRx));
  });
});

describe('createOxcFingerprint — template literal text', () => {
  // 구조 동일, 템플릿의 정적 텍스트(quasi)만 다름. TemplateElement는 visitorKeys가 비어
  // 있어 자식 순회로는 내용이 안 들어가므로, cooked 텍스트를 명시적으로 인코딩하지 않으면
  // 두 함수가 거짓 병합된다 (FP).
  const synonym = 'function f(a: string, b: string) { return `type alias ${a} is a direct synonym for ${b}`; }';
  const equivalent = 'function f(a: string, b: string) { return `type alias ${a} is structurally equivalent to ${b}`; }';

  it('distinguishes different template-literal text at the exact tier (static text is content)', () => {
    expect(exactOfFirstFunction(synonym)).not.toBe(exactOfFirstFunction(equivalent));
  });

  it('also distinguishes different template-literal text at the shape tier (literals never substituted)', () => {
    expect(shapeOfFirstFunction(synonym)).not.toBe(shapeOfFirstFunction(equivalent));
  });

  it('still merges template literals whose only difference is a bound-identifier rename', () => {
    // 텍스트가 같고 보간 식별자(파라미터)만 다르면 shape tier에서 rename-only로 병합돼야 한다.
    const left = 'function f(a: string) { return `value is ${a}`; }';
    const right = 'function f(b: string) { return `value is ${b}`; }';

    expect(shapeOfFirstFunction(left)).toBe(shapeOfFirstFunction(right));
  });
});
