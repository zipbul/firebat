import { describe, it, expect } from 'bun:test';

import type { FileIndexStore } from '../../store/file-index';
import { computeProjectInputsDigest } from './project-inputs-digest';

const noopRepo: FileIndexStore = {
  getFile: () => null,
  upsertFile: () => {},
  deleteFile: () => {},
};

describe('computeProjectInputsDigest', () => {
  it('[HP] returns a non-empty hash string for valid rootAbs', async () => {
    // Use the project root (which has package.json)
    const result = await computeProjectInputsDigest({
      projectKey: 'proj',
      rootAbs: process.cwd(),
      fileIndexRepository: noopRepo,
    });
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('[HP] same rootAbs produces same digest (deterministic)', async () => {
    const opts = { projectKey: 'proj', rootAbs: process.cwd(), fileIndexRepository: noopRepo };
    const a = await computeProjectInputsDigest(opts);
    const b = await computeProjectInputsDigest(opts);
    expect(a).toBe(b);
  });

  it('[HP] returns hash for non-existent rootAbs (missing files treated stably)', async () => {
    const result = await computeProjectInputsDigest({
      projectKey: 'proj',
      rootAbs: '/nonexistent/path/12345',
      fileIndexRepository: noopRepo,
    });
    expect(typeof result).toBe('string');
  });

  it('[ED] returns hash for empty rootAbs', async () => {
    const result = await computeProjectInputsDigest({
      projectKey: 'proj',
      rootAbs: '',
      fileIndexRepository: noopRepo,
    });
    expect(typeof result).toBe('string');
  });
});
