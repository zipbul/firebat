import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { Gildash, GildashOptions } from '@zipbul/gildash';
import type { GildashError } from '@zipbul/gildash';
import { err } from '@zipbul/result';

import { __testing__, createGildash } from './gildash';

const mockOpen = mock<(options: GildashOptions) => Promise<Gildash | ReturnType<typeof err>>>(() =>
  Promise.resolve({ projectRoot: '/test' } as unknown as Gildash),
);

describe('createGildash', () => {
  beforeEach(() => {
    mockOpen.mockClear();
    mockOpen.mockResolvedValue({ projectRoot: '/test' } as unknown as Gildash);
    spyOn(__testing__, 'open').mockImplementation(mockOpen);
  });

  afterEach(() => {
    mockOpen.mockRestore();
  });

  // ---------- HP ----------

  it('should return Gildash instance when called with projectRoot only', async () => {
    const fakeGildash = { projectRoot: '/my/project' } as unknown as Gildash;
    mockOpen.mockResolvedValue(fakeGildash);

    const result = await createGildash({ projectRoot: '/my/project' });

    expect(result).toBe(fakeGildash);
  });

  it('should pass watchMode true to Gildash.open when explicitly provided', async () => {
    await createGildash({ projectRoot: '/proj', watchMode: true });

    expect(mockOpen).toHaveBeenCalledTimes(1);
    const calledWith = mockOpen.mock.calls[0]![0]!;
    expect(calledWith.watchMode).toBe(true);
  });

  it('should pass all options to Gildash.open when fully specified', async () => {
    const opts = {
      projectRoot: '/proj',
      watchMode: true,
      extensions: ['.ts', '.tsx'],
    };

    await createGildash(opts);

    expect(mockOpen).toHaveBeenCalledTimes(1);
    const calledWith = mockOpen.mock.calls[0]![0]!;
    expect(calledWith.projectRoot).toBe('/proj');
    expect(calledWith.watchMode).toBe(true);
    expect(calledWith.extensions).toEqual(['.ts', '.tsx']);
  });

  it('should default watchMode to false when omitted', async () => {
    await createGildash({ projectRoot: '/proj' });

    const calledWith = mockOpen.mock.calls[0]![0]!;
    expect(calledWith.watchMode).toBe(false);
  });

  it('should default extensions to standard TypeScript set when omitted', async () => {
    await createGildash({ projectRoot: '/proj' });

    const calledWith = mockOpen.mock.calls[0]![0]!;
    expect(calledWith.extensions).toEqual(['.ts', '.mts', '.cts', '.tsx']);
  });

  // ---------- NE ----------

  it('should throw Error with formatted message when Gildash.open returns Err', async () => {
    mockOpen.mockResolvedValue(
      err<GildashError>({ type: 'store', message: 'DB corruption', cause: undefined }),
    );

    await expect(createGildash({ projectRoot: '/proj' })).rejects.toThrow(
      'Gildash open failed: DB corruption',
    );
  });

  it('should propagate rejection when Gildash.open throws', async () => {
    mockOpen.mockRejectedValue(new Error('unexpected crash'));

    await expect(createGildash({ projectRoot: '/proj' })).rejects.toThrow(
      'unexpected crash',
    );
  });

  // ---------- ED ----------

  it('should pass empty extensions array as-is without applying defaults', async () => {
    await createGildash({ projectRoot: '/proj', extensions: [] });

    const calledWith = mockOpen.mock.calls[0]![0]!;
    expect(calledWith.extensions).toEqual([]);
  });
});
