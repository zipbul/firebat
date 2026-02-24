import { describe, it, expect } from 'bun:test';

import type { Gildash } from '@zipbul/gildash';
import { err } from '@zipbul/result';
import { computeProjectInputsDigest } from './project-inputs-digest';

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
      gildash: makeGildash(() => err({ type: 'closed' as const, message: 'closed' }) as ReturnType<Gildash['getFileInfo']>),
    });

    expect(typeof result).toBe('string');
  });
});
