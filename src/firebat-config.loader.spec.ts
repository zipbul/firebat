import { describe, it, expect, spyOn, afterEach } from 'bun:test';
import { loadFirebatConfigFile, resolveDefaultFirebatRcPath, DEFAULT_FIREBAT_RC_BASENAME } from './firebat-config.loader';

let fileSpy: ReturnType<typeof spyOn>;

afterEach(() => {
  fileSpy?.mockRestore();
});

describe('resolveDefaultFirebatRcPath', () => {
  it('should append default basename to rootAbs', () => {
    const result = resolveDefaultFirebatRcPath('/project');

    expect(result).toBe(`/project/${DEFAULT_FIREBAT_RC_BASENAME}`);
  });
});

describe('loadFirebatConfigFile', () => {
  it('should return exists:false and config:null when file does not exist', async () => {
    fileSpy = spyOn(Bun, 'file').mockReturnValue({ exists: async () => false, text: async () => '' } as never);

    const result = await loadFirebatConfigFile({ rootAbs: '/project' });

    expect(result.exists).toBe(false);
    expect(result.config).toBeNull();
    expect(result.resolvedPath).toContain(DEFAULT_FIREBAT_RC_BASENAME);
  });

  it('should return exists:true with parsed config for valid JSONC', async () => {
    // Empty config {} is valid (all fields optional)
    const validConfig = JSON.stringify({});
    fileSpy = spyOn(Bun, 'file').mockReturnValue({
      exists: async () => true,
      text: async () => validConfig,
    } as never);

    const result = await loadFirebatConfigFile({ rootAbs: '/project' });

    expect(result.exists).toBe(true);
    expect(result.config).not.toBeNull();
  });

  it('should use configPath when provided', async () => {
    let capturedPath: string | undefined;
    fileSpy = spyOn(Bun, 'file').mockImplementation((p: string) => {
      capturedPath = p;
      return { exists: async () => false, text: async () => '' } as never;
    });

    await loadFirebatConfigFile({ rootAbs: '/project', configPath: '/custom/.firebatrc' });

    expect(capturedPath).toBe('/custom/.firebatrc');
  });

  it('should throw when JSONC parse fails', async () => {
    fileSpy = spyOn(Bun, 'file').mockReturnValue({
      exists: async () => true,
      text: async () => 'not { valid jsonc @@@@',
    } as never);

    await expect(loadFirebatConfigFile({ rootAbs: '/project' })).rejects.toThrow('Failed to parse config');
  });

  it('should throw when config does not match schema', async () => {
    fileSpy = spyOn(Bun, 'file').mockReturnValue({
      exists: async () => true,
      // unknownTopLevel is not in the schema and the schema is strict
      text: async () => JSON.stringify({ unknownTopLevel: 'invalid' }),
    } as never);

    await expect(loadFirebatConfigFile({ rootAbs: '/project' })).rejects.toThrow('Invalid config');
  });
});
