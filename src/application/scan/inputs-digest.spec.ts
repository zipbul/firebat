import type { Gildash } from '@zipbul/gildash';

import { GildashError } from '@zipbul/gildash';
import { describe, it, expect } from 'bun:test';

import { makeFileRecord, makeGildash } from '../../../test/integration/shared/test-kit';
import { computeInputsDigest } from './inputs-digest';

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    const gildash = makeGildash(fp => (fp === '/b.ts' ? makeFileRecord('/b.ts', 'h2') : makeFileRecord('/a.ts', 'h1')));
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

  it('[ED] getFileInfo throws GildashError → falls back to disk read (no throw)', async () => {
    const gildash = makeGildash((): ReturnType<Gildash['getFileInfo']> => {
      throw new GildashError('closed', 'gildash closed');
    });
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
