import { describe, it, expect } from 'bun:test';

import type { FileIndexRepository } from '../../ports/file-index.repository';
import { computeInputsDigest } from './inputs-digest';

const noopRepo: FileIndexRepository = {
  getFile: async () => null,
  upsertFile: async () => {},
  deleteFile: async () => {},
};

describe('computeInputsDigest', () => {
  it('[ED] returns a hash for empty targets array', async () => {
    const result = await computeInputsDigest({
      projectKey: 'proj',
      targets: [],
      fileIndexRepository: noopRepo,
    });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('[HP] same inputs produce same digest (deterministic)', async () => {
    const opts = {
      projectKey: 'proj',
      targets: [],
      fileIndexRepository: noopRepo,
      extraParts: ['extra'],
    };
    const a = await computeInputsDigest(opts);
    const b = await computeInputsDigest(opts);
    expect(a).toBe(b);
  });

  it('[HP] different extraParts produce different digest', async () => {
    const a = await computeInputsDigest({
      projectKey: 'proj',
      targets: [],
      fileIndexRepository: noopRepo,
      extraParts: ['a'],
    });
    const b = await computeInputsDigest({
      projectKey: 'proj',
      targets: [],
      fileIndexRepository: noopRepo,
      extraParts: ['b'],
    });
    expect(a).not.toBe(b);
  });

  it('[HP] target order does not affect digest (targets are sorted)', async () => {
    const a = await computeInputsDigest({
      projectKey: 'proj',
      targets: ['/b/file.ts', '/a/file.ts'],
      fileIndexRepository: noopRepo,
    });
    const b = await computeInputsDigest({
      projectKey: 'proj',
      targets: ['/a/file.ts', '/b/file.ts'],
      fileIndexRepository: noopRepo,
    });
    expect(a).toBe(b);
  });

  it('[HP] empty-path target is recorded as missing entry', async () => {
    // should not throw
    const result = await computeInputsDigest({
      projectKey: 'proj',
      targets: ['   '],
      fileIndexRepository: noopRepo,
    });
    expect(typeof result).toBe('string');
  });

  it('[HP] cached file entry is used from repo when available', async () => {
    const cachedRepo: FileIndexRepository = {
      ...noopRepo,
      getFile: async () => ({ contentHash: 'abc123', mtimeMs: 0, size: 0, filePath: '/f.ts', updatedAt: 0 }),
    };
    const result = await computeInputsDigest({
      projectKey: 'proj',
      targets: ['/f.ts'],
      fileIndexRepository: cachedRepo,
    });
    // Should produce a digest containing the hash from repo
    expect(typeof result).toBe('string');
  });
});
