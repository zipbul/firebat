import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test';
import * as path from 'node:path';

const tsgoRunnerAbs = path.resolve(import.meta.dir, '../../infrastructure/tsgo/tsgo-runner.ts');
const withTsgoLspSessionMock = mock(async () => {
  return { ok: false as const, error: 'tsgo unavailable' };
});
const lspUriToFilePathMock = mock((uri: string) => {
  if (uri.startsWith('file://')) {
    return '/abs/src/a.ts';
  }

  return '/abs/unknown.ts';
});
const openTsDocumentMock = mock(async () => {
  return { uri: 'file:///abs/src/a.ts', text: '' };
});

const __origTsgoRunner = { ...require(tsgoRunnerAbs) };

mock.module(tsgoRunnerAbs, () => {
  return {
    withTsgoLspSession: withTsgoLspSessionMock,
    lspUriToFilePath: lspUriToFilePathMock,
    openTsDocument: openTsDocumentMock,
  };
});

afterEach(() => {
  withTsgoLspSessionMock.mockReset();
  withTsgoLspSessionMock.mockImplementation(async () => ({ ok: false as const, error: 'tsgo unavailable' }));
  lspUriToFilePathMock.mockClear();
  openTsDocumentMock.mockClear();
  mock.clearAllMocks();
});

describe('features/typecheck/detector', () => {
  it('should represent typecheck analysis as a bare array', async () => {
    // Arrange
    const { createEmptyTypecheck } = await import('./detector');
    // Act
    const empty = createEmptyTypecheck();

    // Assert
    expect(Array.isArray(empty)).toBe(true);
    expect(empty).toHaveLength(0);
  });

  it('should normalize diagnostics to use file+msg fields', async () => {
    // Arrange
    const { convertPublishDiagnosticsToTypecheckItems } = await import('./detector');
    // Act
    const items = convertPublishDiagnosticsToTypecheckItems({
      uri: 'file:///abs/src/a.ts',
      diagnostics: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          severity: 1,
          code: 'TS2322',
          message: 'Type error',
          source: 'ts',
        },
      ],
    } as any);

    // Assert
    expect(Array.isArray(items)).toBe(true);
    expect(items).toHaveLength(1);
    expect((items as any[])[0]?.filePath).toBeUndefined();
    expect((items as any[])[0]?.message).toBeUndefined();
    expect(typeof (items as any[])[0]?.file).toBe('string');
    expect(typeof (items as any[])[0]?.msg).toBe('string');
  });

  it('should throw when tsgo session is unavailable', async () => {
    // Arrange
    withTsgoLspSessionMock.mockImplementationOnce(async () => ({ ok: false as const, error: 'tsgo missing' }));

    const { analyzeTypecheck } = await import('./detector');

    // Act + Assert
    await expect(analyzeTypecheck([] as any, { rootAbs: '/abs' } as any)).rejects.toThrow('tsgo');
  });

  it('should convert LSP publishDiagnostics items into typecheck items', async () => {
    // Arrange
    const { convertPublishDiagnosticsToTypecheckItems } = await import('./detector');
    const uri = 'file:///repo/src/a.ts';
    const params = {
      uri,
      diagnostics: [
        {
          range: {
            start: { line: 2, character: 4 },
            end: { line: 2, character: 10 },
          },
          severity: 1,
          code: 'TS2322',
          message: "Type 'string' is not assignable to type 'number'.",
          source: 'tsgo',
        },
        {
          range: {
            start: { line: 9, character: 0 },
            end: { line: 9, character: 6 },
          },
          severity: 2,
          code: 'TS6133',
          message: "'unused' is declared but its value is never read.",
          source: 'tsgo',
        },
        {
          range: {
            start: { line: 12, character: 0 },
            end: { line: 12, character: 1 },
          },
          severity: 3,
          code: 'TS9999',
          message: 'informational',
          source: 'tsgo',
        },
      ],
    };
    // Act
    const items = convertPublishDiagnosticsToTypecheckItems(params as any);

    // Assert
    expect(items).toHaveLength(2);

    const expectedError = {
      severity: 'error',
      code: 'TS2322',
      msg: "Type 'string' is not assignable to type 'number'.",
      file: '/abs/src/a.ts',
      span: {
        start: { line: 3, column: 5 },
        end: { line: 3, column: 11 },
      },
    } satisfies Partial<TypecheckItem>;
    const expectedWarning = {
      severity: 'error',
      code: 'TS6133',
      msg: "'unused' is declared but its value is never read.",
      file: '/abs/src/a.ts',
      span: {
        start: { line: 10, column: 1 },
        end: { line: 10, column: 7 },
      },
    } satisfies Partial<TypecheckItem>;

    expect(items[0]).toMatchObject(expectedError);
    expect(items[1]).toMatchObject(expectedWarning);
  });

  it('should extract diagnostics from pull full report', async () => {
    // Arrange
    const { __test__ } = await import('./detector');
    const raw = {
      kind: 'full',
      items: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          severity: 1,
          message: 'x',
        },
      ],
    };
    // Act
    const items = __test__.pullDiagnosticsToItems(raw);

    // Assert
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ message: 'x' });
  });

  it('should extract diagnostics from pull report items without kind', async () => {
    // Arrange
    const { __test__ } = await import('./detector');
    const raw = {
      items: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          message: 'y',
        },
      ],
    };
    // Act
    const items = __test__.pullDiagnosticsToItems(raw);

    // Assert
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ message: 'y' });
  });
});

afterAll(() => {
  mock.restore();
  mock.module(tsgoRunnerAbs, () => __origTsgoRunner);
});
