import { mock, describe, it, expect, spyOn, beforeEach, afterEach, afterAll } from 'bun:test';
import * as path from 'node:path';

// mock.module must come BEFORE importing oxlint-runner (which imports these at module level)
const mockResolveBin = { tryResolveLocalBin: async (_args: unknown) => '/usr/bin/oxlint' as string | null };
const mockVersionOnce = { logExternalToolVersionOnce: async (_args: unknown) => {} };

const __origResolveBin = { ...require(path.resolve(import.meta.dir, '../resolve-bin.ts')) };
const __origExternalToolVersion = { ...require(path.resolve(import.meta.dir, '../external-tool-version.ts')) };

mock.module(path.resolve(import.meta.dir, '../resolve-bin.ts'), () => mockResolveBin);
mock.module(path.resolve(import.meta.dir, '../external-tool-version.ts'), () => mockVersionOnce);
import { runOxlint, __testing__ } from './oxlint-runner';
import { createNoopLogger } from '../../shared/logger';

const logger = createNoopLogger('error');

const makeProc = (stdout = '', stderr = '', exitCode = 0) => ({
  stdout: new Response(stdout).body!,
  stderr: new Response(stderr).body!,
  exited: Promise.resolve(exitCode),
});

let spawnSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  mockResolveBin.tryResolveLocalBin = async (_args: unknown) => '/usr/bin/oxlint';
  mockVersionOnce.logExternalToolVersionOnce = async (_args: unknown) => {};
});

afterEach(() => {
  spawnSpy?.mockRestore();
});

// --- __testing__.parseOxlintOutput unit tests (no spawn needed) ---

describe('parseOxlintOutput', () => {
  it('should return empty array for non-JSON input', () => {
    expect(__testing__.parseOxlintOutput('not json')).toEqual([]);
  });

  it('should return empty array for invalid JSON schema', () => {
    expect(__testing__.parseOxlintOutput('{"foo":"bar"}')).toEqual([]);
  });

  it('should parse array-style output and normalize fields', () => {
    const raw = JSON.stringify([
      { message: 'use const', severity: 'warning', line: 3, column: 5, filePath: '/src/a.ts' },
    ]);
    const result = __testing__.parseOxlintOutput(raw);

    expect(result).toHaveLength(1);
    expect(result[0]!.message).toBe('use const');
    expect(result[0]!.severity).toBe('warning');
    expect(result[0]!.filePath).toBe('/src/a.ts');
    expect(result[0]!.span.start.line).toBe(3);
    expect(result[0]!.span.start.column).toBe(5);
  });

  it('should parse diagnostics-wrapper-style output', () => {
    const raw = JSON.stringify({
      diagnostics: [{ message: 'no-var', severity: 'error', line: 1, column: 1 }],
    });
    const result = __testing__.parseOxlintOutput(raw);

    expect(result).toHaveLength(1);
    expect(result[0]!.message).toBe('no-var');
    expect(result[0]!.severity).toBe('error');
  });

  it('should fall back to text/level field aliases', () => {
    const raw = JSON.stringify([
      { text: 'aliased message', level: 'info', row: 10, col: 2, path: '/x.ts', ruleId: 'rule-x' },
    ]);
    const result = __testing__.parseOxlintOutput(raw);

    expect(result[0]!.message).toBe('aliased message');
    expect(result[0]!.severity).toBe('info');
    expect(result[0]!.filePath).toBe('/x.ts');
    expect(result[0]!.code).toBe('rule-x');
    expect(result[0]!.span.start.line).toBe(10);
    expect(result[0]!.span.start.column).toBe(2);
  });

  it('should default severity to warning when absent', () => {
    const raw = JSON.stringify([{ message: 'no severity' }]);
    const result = __testing__.parseOxlintOutput(raw);

    expect(result[0]!.severity).toBe('warning');
  });

  it('should default line/column to 0 when absent', () => {
    const raw = JSON.stringify([{ message: 'no position' }]);
    const result = __testing__.parseOxlintOutput(raw);

    expect(result[0]!.span.start.line).toBe(0);
    expect(result[0]!.span.start.column).toBe(0);
  });

  it('should return empty array for empty array input', () => {
    expect(__testing__.parseOxlintOutput('[]')).toEqual([]);
  });
});

// --- runOxlint integration tests (spawn mocked) ---

describe('runOxlint', () => {
  it('should return ok:true with exitCode 0 and empty diagnostics for clean run', async () => {
    spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(makeProc('', '', 0) as ReturnType<typeof Bun.spawn>);

    const result = await runOxlint({ targets: ['/f.ts'], logger });

    expect(result.ok).toBe(true);
    expect(result.tool).toBe('oxlint');
    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toEqual([]);
  });

  it('should return ok:true with diagnostics when stdout is valid JSON array', async () => {
    const diagnosticsJson = JSON.stringify([
      { message: 'no-var', severity: 'error', line: 2, column: 1, filePath: '/a.ts' },
    ]);
    spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(makeProc(diagnosticsJson, '', 1) as ReturnType<typeof Bun.spawn>);

    const result = await runOxlint({ targets: ['/a.ts'], logger });

    expect(result.ok).toBe(true);
    expect(result.tool).toBe('oxlint');
    expect(result.exitCode).toBe(1);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics![0]!.message).toBe('no-var');
  });

  it('should parse stderr diagnostics when stdout has no JSON', async () => {
    const diagnosticsJson = JSON.stringify([{ message: 'stderr-diag', severity: 'warning', line: 1, column: 1 }]);
    spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(makeProc('not-json', diagnosticsJson, 1) as ReturnType<typeof Bun.spawn>);

    const result = await runOxlint({ targets: ['/a.ts'], logger });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics![0]!.message).toBe('stderr-diag');
  });

  it('should return empty diagnostics when stdout and stderr are both non-JSON', async () => {
    spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(makeProc('plain text', 'plain err', 0) as ReturnType<typeof Bun.spawn>);

    const result = await runOxlint({ targets: ['/a.ts'], logger });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });
});

afterAll(() => {
  mock.restore();
  mock.module(path.resolve(import.meta.dir, '../resolve-bin.ts'), () => __origResolveBin);
  mock.module(path.resolve(import.meta.dir, '../external-tool-version.ts'), () => __origExternalToolVersion);
});

