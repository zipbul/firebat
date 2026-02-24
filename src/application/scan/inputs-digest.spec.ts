import { describe, it, expect } from 'bun:test';

import type { Gildash } from '@zipbul/gildash';
import { err } from '@zipbul/result';
import { computeInputsDigest } from './inputs-digest';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeFileRecord = (filePath: string, contentHash = 'abc123') => ({
  project: 'test',
  filePath,
  mtimeMs: 1000,
  size: 100,
  contentHash,
  updatedAt: new Date().toISOString(),
});

const makeGildash = (
  getFileInfoImpl: (filePath: string) => ReturnType<Gildash['getFileInfo']>,
): Gildash =>
  ({
    getFileInfo: getFileInfoImpl,
  }) as unknown as Gildash;

const noopGildash = makeGildash(() => null);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('computeInputsDigest', () => {
  it('[HP] returns digest using contentHash from getFileInfo when FileRecord available', async () => {
    const gildash = makeGildash(() => makeFileRecord('/a.ts', 'hash1'));

    const result = await computeInputsDigest({
      targets: ['/a.ts'],
      gildash,
    });

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('[HP] returns hash for empty targets array', async () => {
    const result = await computeInputsDigest({
      targets: [],
      gildash: noopGildash,
    });

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('[HP] different extraParts produce different digest', async () => {
    const a = await computeInputsDigest({
      targets: [],
      gildash: noopGildash,
      extraParts: ['a'],
    });
    const b = await computeInputsDigest({
      targets: [],
      gildash: noopGildash,
      extraParts: ['b'],
    });

    expect(a).not.toBe(b);
  });

  it('[HP] target order does not affect digest (targets are sorted)', async () => {
    const gildash = makeGildash(fp =>
      fp === '/b.ts' ? makeFileRecord('/b.ts', 'h2') : makeFileRecord('/a.ts', 'h1'),
    );

    const a = await computeInputsDigest({ targets: ['/b.ts', '/a.ts'], gildash });
    const b = await computeInputsDigest({ targets: ['/a.ts', '/b.ts'], gildash });

    expect(a).toBe(b);
  });

  it('[ED] getFileInfo returns null → falls back to disk read (no throw)', async () => {
    const gildash = makeGildash(() => null);

    // Will try to read a non-existent file, but should not throw — returns string
    const result = await computeInputsDigest({
      targets: ['   '],
      gildash,
    });

    expect(typeof result).toBe('string');
  });

  it('[ED] getFileInfo returns Err → falls back to disk read (no throw)', async () => {
    const gildash = makeGildash(
      () => err({ type: 'closed' as const, message: 'gildash closed' }) as ReturnType<Gildash['getFileInfo']>,
    );

    const result = await computeInputsDigest({
      targets: ['   '],
      gildash,
    });

    expect(typeof result).toBe('string');
  });

  it('[ID] same inputs produce same digest (deterministic)', async () => {
    const gildash = makeGildash(() => makeFileRecord('/a.ts', 'stable'));

    const opts = { targets: ['/a.ts'], gildash, extraParts: ['v1'] };
    const x = await computeInputsDigest(opts);
    const y = await computeInputsDigest(opts);

    expect(x).toBe(y);
  });
});
