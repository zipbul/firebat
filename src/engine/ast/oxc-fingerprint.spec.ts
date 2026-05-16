import { describe, expect, it } from 'bun:test';

import { createOxcFingerprintExact, createOxcFingerprintShape } from './oxc-fingerprint';
import { parseSource } from './parse-source';

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
    const a = parseSource(
      '/virtual/fingerprint/paren-a.ts',
      ['export function f() {', '  return (a + b);', '}'].join('\n'),
    );
    const b = parseSource(
      '/virtual/fingerprint/paren-b.ts',
      ['export function f() {', '  return a + b;', '}'].join('\n'),
    );
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
});
