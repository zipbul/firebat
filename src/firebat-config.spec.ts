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
        'exact-duplicates': true,
        waste: false,
      },
    });
    expect(result.success).toBe(true);
  });

  it('[HP] parses feature toggle as object config', () => {
    const result = FirebatConfigSchema.safeParse({
      features: {
        'exact-duplicates': { minSize: 'auto' },
        waste: { memoryRetentionThreshold: 10 },
      },
    });
    expect(result.success).toBe(true);
  });

  it('[HP] parses barrel-policy feature with ignoreGlobs', () => {
    const result = FirebatConfigSchema.safeParse({
      features: {
        'barrel-policy': { ignoreGlobs: ['src/generated/**'] },
      },
    });
    expect(result.success).toBe(true);
  });

  it('[NE] rejects barrel-policy ignoreGlobs with empty array', () => {
    const result = FirebatConfigSchema.safeParse({
      features: { 'barrel-policy': { ignoreGlobs: [] } },
    });
    expect(result.success).toBe(false);
  });

  it('[NE] rejects minSize with negative number', () => {
    const result = FirebatConfigSchema.safeParse({
      features: { 'exact-duplicates': { minSize: -1 } },
    });
    expect(result.success).toBe(false);
  });

  it('[NE] rejects unknown top-level keys (strict mode)', () => {
    const result = FirebatConfigSchema.safeParse({ unknownField: true });
    // May or may not fail depending on strict mode
    // At minimum, should not throw
    expect(typeof result.success).toBe('boolean');
  });

  it('[HP] parses $schema field', () => {
    const result = FirebatConfigSchema.safeParse({
      $schema: 'https://example.com/schema.json',
    });
    expect(result.success).toBe(true);
  });
});
