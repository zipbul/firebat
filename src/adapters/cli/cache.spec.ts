import { mock, afterAll, describe, it, expect, spyOn, afterEach } from 'bun:test';
import * as nodePath from 'node:path';

const __origRuntimeContext = { ...require(nodePath.resolve(import.meta.dir, '../../shared/runtime-context.ts')) };
const __origFsPromises = { ...require('node:fs/promises') };

mock.module(nodePath.resolve(import.meta.dir, '../../shared/runtime-context.ts'), () => ({
  resolveRuntimeContextFromCwd: async () => ({ rootAbs: '/project' }),
}));

const mockRm = mock(async () => undefined);

mock.module('node:fs/promises', () => ({
  rm: mockRm,
}));

import { runCache } from './cache';
import { createNoopLogger } from '../../ports/logger';

const logger = createNoopLogger('error');
let fileSpy: ReturnType<typeof spyOn>;

afterEach(() => {
  fileSpy?.mockRestore();
});

describe('runCache', () => {
  it('should return 1 for unknown command', async () => {
    const result = await runCache(['unknown'], logger);

    expect(result).toBe(1);
  });

  it('should return 1 for empty argv', async () => {
    const result = await runCache([], logger);

    expect(result).toBe(1);
  });

  it('should return 1 for --help flag', async () => {
    // --help sets exitCode=0, but sub !== 'clean' overwrites it to 1
    const result = await runCache(['--help'], logger);

    expect(result).toBe(1);
  });

  it('should return 1 for -h flag', async () => {
    // -h sets exitCode=0, but sub !== 'clean' overwrites it to 1
    const result = await runCache(['-h'], logger);

    expect(result).toBe(1);
  });

  it('should return 0 for "clean" when no files exist', async () => {
    fileSpy = spyOn(Bun, 'file').mockReturnValue({ exists: async () => false } as never);

    const result = await runCache(['clean'], logger);

    expect(result).toBe(0);
  });

  it('should return 0 for "clean" when files are removed successfully', async () => {
    mockRm.mockResolvedValue(undefined as never);
    fileSpy = spyOn(Bun, 'file').mockReturnValue({ exists: async () => true } as never);

    const result = await runCache(['clean'], logger);

    expect(result).toBe(0);
  });
});

afterAll(() => {
  mock.restore();
  mock.module(nodePath.resolve(import.meta.dir, '../../shared/runtime-context.ts'), () => __origRuntimeContext);
  mock.module('node:fs/promises', () => __origFsPromises);
});
