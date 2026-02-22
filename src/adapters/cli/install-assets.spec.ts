import { describe, it, expect, spyOn, afterEach } from 'bun:test';

import {
  OXLINT_RC_JSONC,
  OXFMT_RC_JSONC,
  loadFirstExistingText,
  resolveAssetCandidates,
} from './install-assets';

describe('OXLINT_RC_JSONC', () => {
  it('should be a non-empty string', () => {
    expect(typeof OXLINT_RC_JSONC).toBe('string');
    expect(OXLINT_RC_JSONC.length).toBeGreaterThan(0);
  });

  it('should be valid JSON content (contains $schema)', () => {
    expect(OXLINT_RC_JSONC).toContain('"$schema"');
  });
});

describe('OXFMT_RC_JSONC', () => {
  it('should be a non-empty string', () => {
    expect(typeof OXFMT_RC_JSONC).toBe('string');
    expect(OXFMT_RC_JSONC.length).toBeGreaterThan(0);
  });

  it('should be valid JSON content (contains $schema)', () => {
    expect(OXFMT_RC_JSONC).toContain('"$schema"');
  });
});

describe('resolveAssetCandidates', () => {
  it('should return an array of strings', () => {
    const result = resolveAssetCandidates('firebatrc.schema.json');

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    result.forEach(p => expect(typeof p).toBe('string'));
  });

  it('should include the asset filename in each candidate path', () => {
    const result = resolveAssetCandidates('firebatrc.schema.json');

    result.forEach(p => expect(p).toContain('firebatrc.schema.json'));
  });

  it('should return different candidate paths', () => {
    const result = resolveAssetCandidates('test.json');

    // All candidates should contain the filename
    expect(result.length).toBeGreaterThan(0);
    result.forEach(p => expect(p).toContain('test.json'));
  });
});

describe('loadFirstExistingText', () => {
  let fileSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    fileSpy?.mockRestore();
  });

  it('should throw when candidates is empty', async () => {
    await expect(loadFirstExistingText([])).rejects.toThrow(
      'No asset candidates provided',
    );
  });

  it('should throw when no candidate file exists', async () => {
    fileSpy = spyOn(Bun, 'file').mockReturnValue({ exists: async () => false } as never);

    await expect(loadFirstExistingText(['/not/exist.json', '/also/not.json'])).rejects.toThrow(
      'Could not locate packaged assets/',
    );
  });

  it('should return filePath and text for first existing candidate', async () => {
    fileSpy = spyOn(Bun, 'file').mockImplementation((path: string) => {
      if (path === '/first.json') {
        return { exists: async () => false } as never;
      }

      return {
        exists: async () => true,
        text: async () => '{"hello":"world"}',
      } as never;
    });

    const result = await loadFirstExistingText(['/first.json', '/second.json']);

    expect(result.filePath).toBe('/second.json');
    expect(result.text).toBe('{"hello":"world"}');
  });

  it('should skip candidates where Bun.file throws', async () => {
    let callCount = 0;

    fileSpy = spyOn(Bun, 'file').mockImplementation((_path: string) => {
      callCount++;
      if (callCount === 1) {
        return {
          exists: async () => { throw new Error('disk error'); },
        } as never;
      }

      return {
        exists: async () => true,
        text: async () => 'fallback content',
      } as never;
    });

    const result = await loadFirstExistingText(['/fail.json', '/ok.json']);

    expect(result.filePath).toBe('/ok.json');
    expect(result.text).toBe('fallback content');
  });
});
