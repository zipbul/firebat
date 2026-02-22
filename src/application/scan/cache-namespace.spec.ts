import { describe, it, expect } from 'bun:test';

import { CACHE_SCHEMA_VERSION, computeCacheNamespace } from './cache-namespace';

describe('CACHE_SCHEMA_VERSION', () => {
  it('is a positive integer', () => {
    expect(typeof CACHE_SCHEMA_VERSION).toBe('number');
    expect(Number.isInteger(CACHE_SCHEMA_VERSION)).toBe(true);
    expect(CACHE_SCHEMA_VERSION).toBeGreaterThan(0);
  });
});

describe('computeCacheNamespace', () => {
  it('[HP] returns a non-empty hash string', async () => {
    const result = await computeCacheNamespace({ toolVersion: '1.0.0' });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('[HP] different toolVersions produce different namespaces', async () => {
    const a = await computeCacheNamespace({ toolVersion: '1.0.0' });
    const b = await computeCacheNamespace({ toolVersion: '2.0.0' });
    expect(a).not.toBe(b);
  });

  it('[HP] same toolVersion produces same namespace (deterministic with same script state)', async () => {
    // Same process, same Bun.argv[1] → same buildId
    const a = await computeCacheNamespace({ toolVersion: '1.0.0' });
    const b = await computeCacheNamespace({ toolVersion: '1.0.0' });
    expect(a).toBe(b);
  });
});
