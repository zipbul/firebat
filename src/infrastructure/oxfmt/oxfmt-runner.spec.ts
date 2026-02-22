import { mock, describe, it, expect, spyOn, beforeEach, afterEach, afterAll } from 'bun:test';
import * as path from 'node:path';

// mock.module must come BEFORE importing oxfmt-runner (which imports these at module level)
const mockResolveBin = { tryResolveLocalBin: async (_args: unknown) => '/usr/bin/oxfmt' as string | null };
const mockVersionOnce = { logExternalToolVersionOnce: async (_args: unknown) => {} };

const __origResolveBin = { ...require(path.resolve(import.meta.dir, '../tooling/resolve-bin.ts')) };
const __origExternalToolVersion = { ...require(path.resolve(import.meta.dir, '../tooling/external-tool-version.ts')) };

mock.module(path.resolve(import.meta.dir, '../tooling/resolve-bin.ts'), () => mockResolveBin);
mock.module(path.resolve(import.meta.dir, '../tooling/external-tool-version.ts'), () => mockVersionOnce);
import { runOxfmt } from './oxfmt-runner';
import { createNoopLogger } from '../../ports/logger';

const logger = createNoopLogger('error');

const makeProc = (stdout = '', stderr = '', exitCode = 0) => ({
  stdout: new Response(stdout).body!,
  stderr: new Response(stderr).body!,
  exited: Promise.resolve(exitCode),
});

let spawnSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  mockResolveBin.tryResolveLocalBin = async (_args: unknown) => '/usr/bin/oxfmt';
  mockVersionOnce.logExternalToolVersionOnce = async (_args: unknown) => {};
});

afterEach(() => {
  spawnSpy?.mockRestore();
});

describe('runOxfmt', () => {
  it('should return ok:false with error when binary is not resolved', async () => {
    // Arrange
    mockResolveBin.tryResolveLocalBin = async () => null;

    // Act
    const result = await runOxfmt({ targets: ['/f.ts'], mode: 'check', logger });

    // Assert
    expect(result.ok).toBe(false);
    expect(result.tool).toBe('oxfmt');
    expect(result.error).toBeDefined();
  });

  it('should return ok:true with exitCode/stdout/stderr when check mode runs successfully', async () => {
    // Arrange
    spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(makeProc('ok output', '', 0) as ReturnType<typeof Bun.spawn>);

    // Act
    const result = await runOxfmt({ targets: ['/f.ts'], mode: 'check', logger });

    // Assert
    expect(result.ok).toBe(true);
    expect(result.tool).toBe('oxfmt');
    expect(result.exitCode).toBe(0);
    expect(result.rawStdout).toBe('ok output');
    expect(result.rawStderr).toBe('');
  });

  it('should return ok:true when write mode runs successfully', async () => {
    // Arrange
    spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(makeProc('', '', 0) as ReturnType<typeof Bun.spawn>);

    // Act
    const result = await runOxfmt({ targets: ['/f.ts'], mode: 'write', logger });

    // Assert
    expect(result.ok).toBe(true);
  });

  it('should include --config in args when configPath is provided', async () => {
    // Arrange
    let capturedCmd: string[] | undefined;
    spawnSpy = spyOn(Bun, 'spawn').mockImplementation(({ cmd }: { cmd: string[] }) => {
      capturedCmd = cmd;
      return makeProc() as ReturnType<typeof Bun.spawn>;
    });

    // Act
    await runOxfmt({ targets: ['/f.ts'], mode: 'check', configPath: '/p/.oxfmtrc', logger });

    // Assert
    expect(capturedCmd).toContain('--config');
    expect(capturedCmd).toContain('/p/.oxfmtrc');
  });

  it('should not include --config when configPath is whitespace only', async () => {
    // Arrange
    let capturedCmd: string[] | undefined;
    spawnSpy = spyOn(Bun, 'spawn').mockImplementation(({ cmd }: { cmd: string[] }) => {
      capturedCmd = cmd;
      return makeProc() as ReturnType<typeof Bun.spawn>;
    });

    // Act
    await runOxfmt({ targets: ['/f.ts'], mode: 'check', configPath: '   ', logger });

    // Assert
    expect(capturedCmd).not.toContain('--config');
  });

  it('should return ok:false with error message when spawn throws', async () => {
    // Arrange
    spawnSpy = spyOn(Bun, 'spawn').mockImplementation(() => {
      throw new Error('spawn error');
    });

    // Act
    const result = await runOxfmt({ targets: ['/f.ts'], mode: 'check', logger });

    // Assert
    expect(result.ok).toBe(false);
    expect(result.error).toContain('spawn error');
  });

  it('should include --config flag when configPath is provided', async () => {
    // Arrange
    spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(makeProc() as ReturnType<typeof Bun.spawn>);

    // Act
    await runOxfmt({ targets: ['/f.ts'], mode: 'check', configPath: '/cfg/.oxfmtrc', logger });

    // Assert
    const spawnCall = (spawnSpy.mock.calls[0] as [{ cmd: string[] }])[0];
    expect(spawnCall.cmd).toContain('--config');
    expect(spawnCall.cmd).toContain('/cfg/.oxfmtrc');
  });

  it('should NOT include --config flag when configPath is only whitespace', async () => {
    // Arrange
    spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(makeProc() as ReturnType<typeof Bun.spawn>);

    // Act
    await runOxfmt({ targets: ['/f.ts'], mode: 'check', configPath: '   ', logger });

    // Assert
    const spawnCall = (spawnSpy.mock.calls[0] as [{ cmd: string[] }])[0];
    expect(spawnCall.cmd).not.toContain('--config');
  });
});

afterAll(() => {
  mock.restore();
  mock.module(path.resolve(import.meta.dir, '../tooling/resolve-bin.ts'), () => __origResolveBin);
  mock.module(path.resolve(import.meta.dir, '../tooling/external-tool-version.ts'), () => __origExternalToolVersion);
});

