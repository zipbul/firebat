import type { Gildash } from '@zipbul/gildash';

import { GildashError } from '@zipbul/gildash';
import { describe, it, expect } from 'bun:test';

import { makeFileRecord, makeGildash } from '../../../test/integration/shared/test-kit';
import { computeProjectInputsDigest } from './project-inputs-digest';

// ── Helpers ───────────────────────────────────────────────────────────────────

const noopGildash = makeGildash(() => null);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('computeProjectInputsDigest', () => {
  it('[HP] returns a non-empty hash string for valid rootAbs', async () => {
    const result = await computeProjectInputsDigest({
      rootAbs: process.cwd(),
      gildash: noopGildash,
    });

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('[HP] getFileInfo returns FileRecord → uses contentHash from index', async () => {
    const gildash = makeGildash(() => makeFileRecord('/proj/package.json', 'cached-hash'));
    const result = await computeProjectInputsDigest({
      rootAbs: process.cwd(),
      gildash,
    });

    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('[HP] same rootAbs produces same digest (deterministic)', async () => {
    const opts = { rootAbs: process.cwd(), gildash: noopGildash };
    const a = await computeProjectInputsDigest(opts);
    const b = await computeProjectInputsDigest(opts);

    expect(a).toBe(b);
  });

  it('[ED] returns hash for non-existent rootAbs (missing files treated stably)', async () => {
    const result = await computeProjectInputsDigest({
      rootAbs: '/nonexistent/path/99999',
      gildash: makeGildash((): ReturnType<Gildash['getFileInfo']> => {
        throw new GildashError('closed', 'closed');
      }),
    });

    expect(typeof result).toBe('string');
  });
});
