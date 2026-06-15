import { mock, describe, it, expect, spyOn, beforeEach, afterEach, afterAll } from 'bun:test';
import * as path from 'node:path';

import { makeProc, restoreToolMocks } from '../../../test/integration/shared/external-tool-test-kit';

// mock.module must come BEFORE importing oxfmt-runner (which imports these at module level)
const mockResolveBin = { tryResolveLocalBin: async (_args: unknown) => '/usr/bin/oxfmt' as string | null };
const mockVersionOnce = { logExternalToolVersionOnce: async (_args: unknown) => {} };
const resolveBinPath = path.resolve(import.meta.dir, '../resolve-bin.ts');
const externalToolVersionPath = path.resolve(import.meta.dir, '../external-tool-version.ts');
const origResolveBin = { ...require(resolveBinPath) };
const origExternalToolVersion = { ...require(externalToolVersionPath) };

void mock.module(resolveBinPath, () => mockResolveBin);
void mock.module(externalToolVersionPath, () => mockVersionOnce);

import { createNoopLogger } from '../../shared/logger';
import { runOxfmt } from './oxfmt-runner';

const logger = createNoopLogger('error');
let spawnSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  mockResolveBin.tryResolveLocalBin = async (_args: unknown) => '/usr/bin/oxfmt';
  mockVersionOnce.logExternalToolVersionOnce = async (_args: unknown) => {};
});

afterEach(() => {
  spawnSpy?.mockRestore();
});

interface ConfigFlagRow {
  readonly name: string;
  readonly configPath: string;
  readonly assertCmd: (cmd: string[]) => void;
}

const expectConfigPresent =
  (configPath: string) =>
  (cmd: string[]): void => {
    expect(cmd).toContain('--config');
    expect(cmd).toContain(configPath);
  };

const expectConfigAbsent = (cmd: string[]): void => {
  expect(cmd).not.toContain('--config');
};

const configFlagRows: ConfigFlagRow[] = [
  {
    name: 'include --config in args when configPath is provided',
    configPath: '/p/.oxfmtrc',
    assertCmd: expectConfigPresent('/p/.oxfmtrc'),
  },
  {
    name: 'include --config flag when configPath is provided (cfg path)',
    configPath: '/cfg/.oxfmtrc',
    assertCmd: expectConfigPresent('/cfg/.oxfmtrc'),
  },
  { name: 'not include --config when configPath is whitespace only', configPath: '   ', assertCmd: expectConfigAbsent },
  { name: 'NOT include --config flag when configPath is only whitespace', configPath: '   ', assertCmd: expectConfigAbsent },
];

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

  it.each(configFlagRows)('should $name', async ({ configPath, assertCmd }) => {
    // Arrange
    spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(makeProc() as ReturnType<typeof Bun.spawn>);

    // Act
    await runOxfmt({ targets: ['/f.ts'], mode: 'check', configPath, logger });

    // Assert
    const spawnCall = (spawnSpy.mock.calls[0] as [{ cmd: string[] }])[0];

    assertCmd(spawnCall.cmd);
  });

  it('should return ok:false when exit code is non-zero with empty stdout (config error)', async () => {
    // Real-world scenario: `bunx oxfmt --check --config /tmp/no-such.json` exits 1 with
    // stderr "Failed to load configuration file" and empty stdout. Previously oxfmt-runner
    // returned ok:true and analyzeFormat silently returned [] (no files-need-format) and
    // the failure was invisible.
    spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(
      makeProc('', 'Failed to load configuration file\nFailed to read /tmp/no-such.json: File not found\n', 1) as ReturnType<
        typeof Bun.spawn
      >,
    );

    const result = await runOxfmt({ targets: ['/f.ts'], mode: 'check', logger });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.error).toBeDefined();
  });

  it('should return ok:true when exit code is non-zero but stdout lists files (check mode with diffs)', async () => {
    // Normal check-mode failure path: exit 1 means files need formatting, stdout lists them.
    spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(makeProc('src/a.ts\nsrc/b.ts\n', '', 1) as ReturnType<typeof Bun.spawn>);

    const result = await runOxfmt({ targets: ['/f.ts'], mode: 'check', logger });

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.rawStdout).toContain('src/a.ts');
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
});

afterAll(() => {
  restoreToolMocks({ resolveBinPath, externalToolVersionPath, origResolveBin, origExternalToolVersion });
});
