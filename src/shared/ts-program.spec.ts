import type { Gildash } from '@zipbul/gildash';

import { mock, describe, it, expect, beforeEach, afterEach, afterAll } from 'bun:test';
import * as nodePath from 'node:path';

import type { ParsedFile } from '../engine/types';

import { emptyBatchParse as defaultBatchParse, expectEmptyAndUncalled } from '../../test/integration/shared/test-kit';
import { createNoopLogger } from './logger';

// ── Save originals before mocking ────────────────────────────────────────────

const __origGildashStore = { ...require(nodePath.resolve(import.meta.dir, '../store/gildash.ts')) };
// ── Mocks ─────────────────────────────────────────────────────────────────────
const mockClose = mock(async (_opts?: { cleanup?: boolean }) => {});
const mockBatchParse = mock(defaultBatchParse);
const mockGildash = {
  batchParse: mockBatchParse,
  close: mockClose,
} as unknown as Gildash;
const mockCreateGildash = mock(async (_opts: unknown) => mockGildash);

void mock.module('../store/gildash', () => ({ createGildash: mockCreateGildash }));

// ── Import after mock ─────────────────────────────────────────────────────────

import { createFirebatProgram } from './ts-program';

const logger = createNoopLogger('error');

const makeParsedFile = (filePath: string): ParsedFile => ({
  filePath,
  program: {} as ParsedFile['program'],
  errors: [],
  comments: [],
  sourceText: `// ${filePath}`,
  module: {} as never,
});

const batchParseReturnsOk =
  (entries: [string, ParsedFile][]) =>
  async (_filePaths: string[]): Promise<{ parsed: Map<string, ParsedFile>; failures: Array<unknown> }> => ({
    parsed: new Map(entries),
    failures: [],
  });

/** Stub `mockBatchParse` to resolve a single parsed file for `filePath`. */
const mockParseOne = (filePath: string): void => {
  const pf = makeParsedFile(filePath);

  mockBatchParse.mockImplementation(batchParseReturnsOk([[filePath, pf]]));
};

// ── Helpers ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockCreateGildash.mockReset();
  mockClose.mockReset();
  mockBatchParse.mockReset();

  mockCreateGildash.mockImplementation(async (_opts: unknown) => mockGildash);
  mockClose.mockImplementation(async (_opts?: { cleanup?: boolean }) => {});
  mockBatchParse.mockImplementation(defaultBatchParse);
});

afterEach(() => {
  mock.restore();
});

afterAll(() => {
  mock.restore();
  void mock.module(nodePath.resolve(import.meta.dir, '../store/gildash.ts'), () => __origGildashStore);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createFirebatProgram', () => {
  it('should return ParsedFile array when batchParse succeeds with eligible targets', async () => {
    // Arrange
    mockParseOne('/proj/src/a.ts');

    // Act
    const result = await createFirebatProgram({ targets: ['/proj/src/a.ts'], logger });

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.filePath).toBe('/proj/src/a.ts');
  });

  it.each<[string, string]>([
    ['a node_modules path', '/proj/node_modules/lib/index.ts'],
    ['a .d.ts file', '/proj/src/types.d.ts'],
  ])('should exclude %s from the batchParse call', async (_label, excludedTarget) => {
    // Arrange
    mockParseOne('/proj/src/a.ts');

    // Act
    await createFirebatProgram({
      targets: ['/proj/src/a.ts', excludedTarget],
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
    expect(mockCreateGildash).toHaveBeenCalledWith(expect.objectContaining({ watchMode: false }));
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
    expectEmptyAndUncalled(result, mockCreateGildash);
  });

  it.each<[string, string[]]>([
    ['all targets are in node_modules', ['/proj/node_modules/a.ts', '/proj/node_modules/sub/b.ts']],
    ['all targets are .d.ts files', ['/proj/src/types.d.ts', '/proj/src/global.d.ts']],
  ])('should return empty array and not create gildash when %s', async (_label, targets) => {
    // Arrange & Act
    const result = await createFirebatProgram({ targets, logger });

    // Assert
    expectEmptyAndUncalled(result, mockCreateGildash);
  });

  it('should propagate error when batchParse throws', async () => {
    // Arrange
    mockBatchParse.mockRejectedValue(new Error('gildash closed'));

    // Act & Assert
    await expect(createFirebatProgram({ targets: ['/a.ts'], logger })).rejects.toThrow('gildash closed');
  });

  it('should call gildash.close even when batchParse throws', async () => {
    // Arrange
    mockBatchParse.mockRejectedValue(new Error('gildash closed'));

    // Act & Assert — the rejection is expected; assert it instead of swallowing it,
    // then confirm cleanup still ran.
    await expect(createFirebatProgram({ targets: ['/a.ts'], logger })).rejects.toThrow('gildash closed');

    expect(mockClose).toHaveBeenCalledWith({ cleanup: false });
  });

  it('should propagate error when createGildash throws', async () => {
    // Arrange
    mockCreateGildash.mockImplementation(async () => {
      throw new Error('open failed');
    });

    // Act & Assert
    await expect(createFirebatProgram({ targets: ['/a.ts'], logger })).rejects.toThrow('open failed');
  });

  it('should return early with empty array and call nothing when all targets are mixed excluded', async () => {
    // Arrange & Act
    const result = await createFirebatProgram({
      targets: ['/proj/node_modules/a.ts', '/proj/src/types.d.ts'],
      logger,
    });

    // Assert
    expectEmptyAndUncalled(result, mockCreateGildash);
    expect(mockBatchParse).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });
});
