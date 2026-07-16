import { describe, it, expect } from 'bun:test';

import { FirebatConfigSchema } from './firebat-config';

describe('FirebatConfigSchema', () => {
  it('[HP] parses an empty config object', () => {
    const result = FirebatConfigSchema.safeParse({});

    expect(result.success).toBe(true);
  });

  it('[HP] parses a minimal valid config with features', () => {
    const result = FirebatConfigSchema.safeParse({
      features: {
        duplicates: true,
        waste: false,
      },
    });

    expect(result.success).toBe(true);
  });

  it('[HP] parses feature toggle as object config', () => {
    const result = FirebatConfigSchema.safeParse({
      features: {
        duplicates: { minSize: 'auto' },
        waste: true,
      },
    });

    expect(result.success).toBe(true);
  });

  it('[HP] parses barrel feature with ignoreGlobs', () => {
    const result = FirebatConfigSchema.safeParse({
      features: {
        barrel: { ignoreGlobs: ['src/generated/**'] },
      },
    });

    expect(result.success).toBe(true);
  });

  it('[HP] accepts barrel ignoreGlobs with empty array (replace semantics)', () => {
    const result = FirebatConfigSchema.safeParse({
      features: { barrel: { ignoreGlobs: [] } },
    });

    expect(result.success).toBe(true);
  });

  it('[NE] rejects minSize with negative number', () => {
    const result = FirebatConfigSchema.safeParse({
      features: { duplicates: { minSize: -1 } },
    });

    expect(result.success).toBe(false);
  });

  it('[NE] rejects unknown top-level keys (strict mode)', () => {
    const result = FirebatConfigSchema.safeParse({ unknownField: true });

    expect(result.success).toBe(false);
  });

  it('[HP] parses $schema field', () => {
    const result = FirebatConfigSchema.safeParse({
      $schema: 'https://example.com/schema.json',
    });

    expect(result.success).toBe(true);
  });

  it('[HP] parses exclude with glob patterns', () => {
    const result = FirebatConfigSchema.safeParse({
      exclude: ['**/__fixtures__/**'],
    });

    expect(result.success).toBe(true);
  });

  it('[NE] rejects exclude with non-string elements', () => {
    const result = FirebatConfigSchema.safeParse({
      exclude: [123],
    });

    expect(result.success).toBe(false);
  });

  // giant-file surgery (PLAN-giant-file-surgery.md D7): the dead defensive
  // `Math.max(0, Math.floor())` clamp is removed in P2 — zod `.int().nonnegative()`
  // rejection is the contract for invalid maxLines, not silent flooring. These
  // pins are the guard that must exist (and already pass) BEFORE the clamp unit
  // test is deleted.
  it('PIN: [NE] rejects giant-file maxLines negative number', () => {
    const result = FirebatConfigSchema.safeParse({
      features: { 'giant-file': { maxLines: -1 } },
    });

    expect(result.success).toBe(false);
  });

  it('PIN: [NE] rejects giant-file maxLines fractional number', () => {
    const result = FirebatConfigSchema.safeParse({
      features: { 'giant-file': { maxLines: 1.5 } },
    });

    expect(result.success).toBe(false);
  });

  it('PIN: [NE] rejects giant-file maxLines as a string', () => {
    const result = FirebatConfigSchema.safeParse({
      features: { 'giant-file': { maxLines: '800' } },
    });

    expect(result.success).toBe(false);
  });
});
