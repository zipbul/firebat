import { mock, describe, it, expect, spyOn, beforeEach, afterEach, afterAll } from 'bun:test';
import * as path from 'node:path';

import { expectToolFailure, makeProc, registerToolMockTeardown } from '../../../test/integration/shared/external-tool-test-kit';

// mock.module must come BEFORE importing oxlint-runner (which imports these at module level)
const mockResolveBin = { tryResolveLocalBin: async (_args: unknown) => '/usr/bin/oxlint' as string | null };
const mockVersionOnce = { logExternalToolVersionOnce: async (_args: unknown) => {} };
const resolveBinPath = path.resolve(import.meta.dir, '../resolve-bin.ts');
const externalToolVersionPath = path.resolve(import.meta.dir, '../external-tool-version.ts');
const origResolveBin = { ...require(resolveBinPath) };
const origExternalToolVersion = { ...require(externalToolVersionPath) };

void mock.module(resolveBinPath, () => mockResolveBin);
void mock.module(externalToolVersionPath, () => mockVersionOnce);

import { createNoopLogger } from '../../shared/logger';
import { runOxlint, __testing__ } from './oxlint-runner';

const logger = createNoopLogger('error');
let spawnSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  mockResolveBin.tryResolveLocalBin = async (_args: unknown) => '/usr/bin/oxlint';
  mockVersionOnce.logExternalToolVersionOnce = async (_args: unknown) => {};
});

afterEach(() => {
  spawnSpy?.mockRestore();
});

// --- __testing__.parseOxlintOutput unit tests (no spawn needed) ---

interface ParseEmptyRow {
  readonly name: string;
  readonly raw: string;
}

interface ParseDiagRow {
  readonly name: string;
  readonly raw: string;
  readonly message: string;
  readonly severity: 'error' | 'info' | 'warning';
  readonly filePath: string | undefined;
  readonly code: string | undefined;
  readonly line: number;
  readonly column: number;
}

const parseEmptyRows: ParseEmptyRow[] = [
  { name: 'non-JSON input', raw: 'not json' },
  { name: 'invalid JSON schema', raw: '{"foo":"bar"}' },
  { name: 'empty array input', raw: '[]' },
];
const parseDiagRows: ParseDiagRow[] = [
  {
    name: 'array-style output and normalize fields',
    raw: JSON.stringify([{ message: 'use const', severity: 'warning', line: 3, column: 5, filePath: '/src/a.ts' }]),
    message: 'use const',
    severity: 'warning',
    filePath: '/src/a.ts',
    code: undefined,
    line: 3,
    column: 5,
  },
  {
    name: 'diagnostics-wrapper-style output',
    raw: JSON.stringify({ diagnostics: [{ message: 'no-var', severity: 'error', line: 1, column: 1 }] }),
    message: 'no-var',
    severity: 'error',
    filePath: undefined,
    code: undefined,
    line: 1,
    column: 1,
  },
  {
    name: 'text/level field aliases',
    raw: JSON.stringify([{ text: 'aliased message', level: 'info', row: 10, col: 2, path: '/x.ts', ruleId: 'rule-x' }]),
    message: 'aliased message',
    severity: 'info',
    filePath: '/x.ts',
    code: 'rule-x',
    line: 10,
    column: 2,
  },
  {
    name: 'default severity to warning when absent',
    raw: JSON.stringify([{ message: 'no severity' }]),
    message: 'no severity',
    severity: 'warning',
    filePath: undefined,
    code: undefined,
    line: 0,
    column: 0,
  },
  {
    name: 'default line/column to 0 when absent',
    raw: JSON.stringify([{ message: 'no position' }]),
    message: 'no position',
    severity: 'warning',
    filePath: undefined,
    code: undefined,
    line: 0,
    column: 0,
  },
];

describe('parseOxlintOutput', () => {
  it.each(parseEmptyRows)('should return empty array for $name', ({ raw }) => {
    expect(__testing__.parseOxlintOutput(raw)).toEqual([]);
  });

  it.each(parseDiagRows)('should parse $name', ({ raw, message, severity, filePath, code, line, column }) => {
    const result = __testing__.parseOxlintOutput(raw);

    expect(result).toHaveLength(1);
    expect(result[0]!.message).toBe(message);
    expect(result[0]!.severity).toBe(severity);
    expect(result[0]!.filePath).toBe(filePath);
    expect(result[0]!.code).toBe(code);
    expect(result[0]!.span.start.line).toBe(line);
    expect(result[0]!.span.start.column).toBe(column);
  });
});

// --- runOxlint integration tests (spawn mocked) ---

/** Run oxlint over `targets`, assert ok:true, and return the result. */
const runOxlintOk = async (targets: string[]): Promise<Awaited<ReturnType<typeof runOxlint>>> => {
  const result = await runOxlint({ targets, logger });

  expect(result.ok).toBe(true);

  return result;
};

describe('runOxlint', () => {
  it('should return ok:true with exitCode 0 and empty diagnostics for clean run', async () => {
    spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(makeProc('', '', 0) as ReturnType<typeof Bun.spawn>);

    const result = await runOxlintOk(['/f.ts']);
    expect(result.tool).toBe('oxlint');
    expect(result.exitCode).toBe(0);
    expect(result.diagnostics).toEqual([]);
  });

  it('should return ok:true with diagnostics when stdout is valid JSON array', async () => {
    const diagnosticsJson = JSON.stringify([{ message: 'no-var', severity: 'error', line: 2, column: 1, filePath: '/a.ts' }]);

    spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(makeProc(diagnosticsJson, '', 1) as ReturnType<typeof Bun.spawn>);

    const result = await runOxlintOk(['/a.ts']);
    expect(result.tool).toBe('oxlint');
    expect(result.exitCode).toBe(1);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics![0]!.message).toBe('no-var');
  });

  it('should parse stderr diagnostics when stdout has no JSON', async () => {
    const diagnosticsJson = JSON.stringify([{ message: 'stderr-diag', severity: 'warning', line: 1, column: 1 }]);

    spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(makeProc('not-json', diagnosticsJson, 1) as ReturnType<typeof Bun.spawn>);

    const result = await runOxlintOk(['/a.ts']);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics![0]!.message).toBe('stderr-diag');
  });

  it('should return empty diagnostics when stdout and stderr are both non-JSON', async () => {
    spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(makeProc('plain text', 'plain err', 0) as ReturnType<typeof Bun.spawn>);

    const result = await runOxlintOk(['/a.ts']);
    expect(result.diagnostics).toEqual([]);
  });

  it('should return ok:false when exit code is non-zero and no diagnostics were parsed (config error)', async () => {
    // Real-world scenario: `bunx oxlint --config /tmp/no-such.json` exits 1 with stderr
    // "Failed to parse oxlint configuration file." and empty stdout. Previously oxlint-runner
    // returned ok:true with empty diagnostics, so analyzeLint silently returned [].
    spawnSpy = spyOn(Bun, 'spawn').mockReturnValue(
      makeProc('', 'Failed to parse oxlint configuration file.\n', 1) as ReturnType<typeof Bun.spawn>,
    );

    const result = await runOxlint({ targets: ['/a.ts'], logger });

    expectToolFailure(result);
  });
});

registerToolMockTeardown({ resolveBinPath, externalToolVersionPath, origResolveBin, origExternalToolVersion });
