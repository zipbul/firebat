import { describe, expect, it } from 'bun:test';

describe('features/typecheck/detector', () => {
  it('createEmptyTypecheck - returns empty array', async () => {
    const { createEmptyTypecheck } = await import('./detector');
    const empty = createEmptyTypecheck();

    expect(Array.isArray(empty)).toBe(true);
    expect(empty).toHaveLength(0);
  });

  it('analyzeTypecheck - throws when tsconfig.json not found', async () => {
    const { analyzeTypecheck } = await import('./detector');

    await expect(analyzeTypecheck([], { rootAbs: '/nonexistent-dir' })).rejects.toThrow('tsconfig.json not found');
  });
});
