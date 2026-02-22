import { describe, it, expect, spyOn, afterEach } from 'bun:test';
import { resolveToolRcPath } from './scan.usecase';

// resolveToolRcPath is a pure utility that only uses Bun.file().exists()
// It is exported and can be tested independently without mocking all heavy imports.

let fileSpy: ReturnType<typeof spyOn>;

afterEach(() => {
  fileSpy?.mockRestore();
});

describe('resolveToolRcPath', () => {
  it('should return undefined when file does not exist', async () => {
    fileSpy = spyOn(Bun, 'file').mockReturnValue({ exists: async () => false } as never);

    const result = await resolveToolRcPath('/project', '.firebatrc');

    expect(result).toBeUndefined();
  });

  it('should return full path when file exists', async () => {
    fileSpy = spyOn(Bun, 'file').mockReturnValue({ exists: async () => true } as never);

    const result = await resolveToolRcPath('/project', '.firebatrc');

    expect(result).toBe('/project/.firebatrc');
  });

  it('should return undefined when Bun.file throws', async () => {
    fileSpy = spyOn(Bun, 'file').mockImplementation(() => {
      throw new Error('fs error');
    });

    const result = await resolveToolRcPath('/project', '.firebatrc');

    expect(result).toBeUndefined();
  });

  it('should join root and basename correctly', async () => {
    let capturedPath: string | undefined;
    fileSpy = spyOn(Bun, 'file').mockImplementation((p: string) => {
      capturedPath = p;
      return { exists: async () => false } as never;
    });

    await resolveToolRcPath('/my/project', 'custom.rc');

    expect(capturedPath).toBe('/my/project/custom.rc');
  });
});
