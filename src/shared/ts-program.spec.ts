import { mock, describe, it, expect, beforeEach, afterEach } from 'bun:test';

import type { Gildash } from '@zipbul/gildash';
import type { ParsedFile } from './ts-program';
import { err } from '@zipbul/result';
import { createNoopLogger } from './logger';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockClose = mock(async (_opts?: { cleanup?: boolean }) => {});
const mockBatchParse = mock(
  async (_filePaths: string[]): Promise<Map<string, unknown>> => new Map(),
);

const mockGildash = {
  batchParse: mockBatchParse,
  close: mockClose,
} as unknown as Gildash;

const mockCreateGildash = mock(async (_opts: unknown) => mockGildash);

mock.module('../store/gildash', () => ({ createGildash: mockCreateGildash }));

// ── Import after mock ─────────────────────────────────────────────────────────

import { createFirebatProgram } from './ts-program';

const logger = createNoopLogger('error');

const makeParsedFile = (filePath: string): ParsedFile => ({
  filePath,
  program: {} as ParsedFile['program'],
  errors: [],
  comments: [],
  sourceText: `// ${filePath}`,
});

const batchParseReturnsOk =
  (entries: [string, ParsedFile][]) =>
  async (_filePaths: string[]): Promise<Map<string, ParsedFile>> =>
    new Map(entries);

// ── Helpers ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockCreateGildash.mockReset();
  mockClose.mockReset();
  mockBatchParse.mockReset();

  mockCreateGildash.mockImplementation(async (_opts: unknown) => mockGildash);
  mockClose.mockImplementation(async (_opts?: { cleanup?: boolean }) => {});
  mockBatchParse.mockImplementation(
    async (_filePaths: string[]): Promise<Map<string, unknown>> => new Map(),
  );
});

afterEach(() => {
  mock.restore();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createFirebatProgram', () => {
  it('should return ParsedFile array when batchParse succeeds with eligible targets', async () => {
    // Arrange
    const pf = makeParsedFile('/proj/src/a.ts');
    mockBatchParse.mockImplementation(batchParseReturnsOk([['/proj/src/a.ts', pf]]));

    // Act
    const result = await createFirebatProgram({ targets: ['/proj/src/a.ts'], logger });

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.filePath).toBe('/proj/src/a.ts');
  });

  it('should exclude node_modules path from batchParse call', async () => {
    // Arrange
    const pf = makeParsedFile('/proj/src/a.ts');
    mockBatchParse.mockImplementation(batchParseReturnsOk([['/proj/src/a.ts', pf]]));

    // Act
    await createFirebatProgram({
      targets: ['/proj/src/a.ts', '/proj/node_modules/lib/index.ts'],
      logger,
    });

    // Assert
    const [calledWith] = mockBatchParse.mock.calls[0] as [string[]];
    expect(calledWith).toEqual(['/proj/src/a.ts']);
  });

  it('should exclude .d.ts files from batchParse call', async () => {
    // Arrange
    const pf = makeParsedFile('/proj/src/a.ts');
    mockBatchParse.mockImplementation(batchParseReturnsOk([['/proj/src/a.ts', pf]]));

    // Act
    await createFirebatProgram({
      targets: ['/proj/src/a.ts', '/proj/src/types.d.ts'],
      logger,
    });

    // Assert
    const [calledWith] = mockBatchParse.mock.calls[0] as [string[]];
    expect(calledWith).toEqual(['/proj/src/a.ts']);
  });

  it('should call gildash.close with cleanup false on success', async () => {
    // Arrange
    mockBatchParse.mockImplementation(batchParseReturnsOk([]));

    // Act
    await createFirebatProgram({ targets: ['/a.ts'], logger });

    // Assert
    expect(mockClose).toHaveBeenCalledWith({ cleanup: false });
  });

  it('should call createGildash with watchMode false', async () => {
    // Arrange
    mockBatchParse.mockImplementation(batchParseReturnsOk([]));

    // Act
    await createFirebatProgram({ targets: ['/a.ts'], logger });

    // Assert
    expect(mockCreateGildash).toHaveBeenCalledWith(
      expect.objectContaining({ watchMode: false }),
    );
  });

  it('should pass eligible file paths to batchParse', async () => {
    // Arrange
    mockBatchParse.mockImplementation(batchParseReturnsOk([]));

    // Act
    await createFirebatProgram({ targets: ['/a.ts', '/b.ts'], logger });

    // Assert
    expect(mockBatchParse).toHaveBeenCalledWith(['/a.ts', '/b.ts']);
  });

  it('should return empty array and not create gildash when targets is empty', async () => {
    // Arrange & Act
    const result = await createFirebatProgram({ targets: [], logger });

    // Assert
    expect(result).toEqual([]);
    expect(mockCreateGildash).not.toHaveBeenCalled();
  });

  it('should return empty array and not create gildash when all targets are in node_modules', async () => {
    // Arrange & Act
    const result = await createFirebatProgram({
      targets: ['/proj/node_modules/a.ts', '/proj/node_modules/sub/b.ts'],
      logger,
    });

    // Assert
    expect(result).toEqual([]);
    expect(mockCreateGildash).not.toHaveBeenCalled();
  });

  it('should return empty array and not create gildash when all targets are .d.ts files', async () => {
    // Arrange & Act
    const result = await createFirebatProgram({
      targets: ['/proj/src/types.d.ts', '/proj/src/global.d.ts'],
      logger,
    });

    // Assert
    expect(result).toEqual([]);
    expect(mockCreateGildash).not.toHaveBeenCalled();
  });

  it('should return empty array when batchParse returns Err', async () => {
    // Arrange
    mockBatchParse.mockImplementation(
      async () => err({ type: 'closed' as const, message: 'gildash closed' }) as unknown as Map<string, unknown>,
    );

    // Act
    const result = await createFirebatProgram({ targets: ['/a.ts'], logger });

    // Assert
    expect(result).toEqual([]);
  });

  it('should call gildash.close even when batchParse returns Err', async () => {
    // Arrange
    mockBatchParse.mockImplementation(
      async () => err({ type: 'closed' as const, message: 'gildash closed' }) as unknown as Map<string, unknown>,
    );

    // Act
    await createFirebatProgram({ targets: ['/a.ts'], logger });

    // Assert
    expect(mockClose).toHaveBeenCalledWith({ cleanup: false });
  });

  it('should propagate error when createGildash throws', async () => {
    // Arrange
    mockCreateGildash.mockImplementation(async () => {
      throw new Error('open failed');
    });

    // Act & Assert
    await expect(
      createFirebatProgram({ targets: ['/a.ts'], logger }),
    ).rejects.toThrow('open failed');
  });

  it('should return early with empty array and call nothing when all targets are mixed excluded', async () => {
    // Arrange & Act
    const result = await createFirebatProgram({
      targets: ['/proj/node_modules/a.ts', '/proj/src/types.d.ts'],
      logger,
    });

    // Assert
    expect(result).toEqual([]);
    expect(mockCreateGildash).not.toHaveBeenCalled();
    expect(mockBatchParse).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });
});
