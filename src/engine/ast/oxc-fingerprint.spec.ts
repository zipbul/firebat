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
