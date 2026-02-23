import { mock, afterAll, describe, it, expect, beforeEach } from 'bun:test';
import path from 'node:path';

const runOxlintMock = mock(
  (_input: unknown): Promise<{ ok: boolean; diagnostics?: unknown[]; error?: string }> =>
    Promise.resolve({ ok: true, diagnostics: [] }),
);

const __origOxlintRunner = { ...require(path.resolve(import.meta.dir, '../../tooling/oxlint/oxlint-runner.ts')) };

mock.module(path.resolve(import.meta.dir, '../../tooling/oxlint/oxlint-runner.ts'), () => ({
  runOxlint: runOxlintMock,
}));

const { analyzeLint, createEmptyLint } = await import('./analyzer');

describe('createEmptyLint', () => {
  it('returns an empty array', () => {
    expect(createEmptyLint()).toEqual([]);
  });
});

describe('analyzeLint', () => {
  beforeEach(() => {
    runOxlintMock.mockReset();
    runOxlintMock.mockImplementation(() => Promise.resolve({ ok: true, diagnostics: [] }));
  });

  it('[HP] returns [] when oxlint reports no diagnostics', async () => {
    const result = await analyzeLint({ targets: ['src/'], fix: false });
    expect(result).toEqual([]);
  });

  it('[HP] returns findings for error-severity diagnostics', async () => {
    runOxlintMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        diagnostics: [
          { filePath: 'a.ts', message: 'lint error', severity: 'error', code: 'no-debugger', span: null },
        ],
      }),
    );
    const result = await analyzeLint({ targets: ['src/'], fix: false });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ file: 'a.ts', severity: 'error' });
  });

  it('[HP] filters out info-severity diagnostics', async () => {
    runOxlintMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        diagnostics: [
          { filePath: 'a.ts', message: 'info', severity: 'info', span: null },
        ],
      }),
    );
    const result = await analyzeLint({ targets: ['src/'], fix: false });
    expect(result).toEqual([]);
  });

  it('[HP] throws when oxlint reports ok=false', async () => {
    runOxlintMock.mockImplementation(() =>
      Promise.resolve({ ok: false, diagnostics: [], error: 'oxlint crashed' }),
    );
    await expect(analyzeLint({ targets: ['src/'], fix: false })).rejects.toThrow('oxlint crashed');
  });

  it('[HP] returns [] when fix=true (even with diagnostics)', async () => {
    runOxlintMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        diagnostics: [
          { filePath: 'a.ts', message: 'msg', severity: 'error', span: null },
        ],
      }),
    );
    const result = await analyzeLint({ targets: ['src/'], fix: true });
    expect(result).toEqual([]);
  });
});

afterAll(() => {
  mock.restore();
  mock.module(path.resolve(import.meta.dir, '../../tooling/oxlint/oxlint-runner.ts'), () => __origOxlintRunner);
});
