import type { Gildash } from '@zipbul/gildash';
import type { PatternMatch } from '@zipbul/gildash';

import { GildashError } from '@zipbul/gildash';
import { mock, describe, it, expect, beforeEach, afterEach, afterAll, spyOn } from 'bun:test';
import * as nodePath from 'node:path';

// ── Save originals before mocking ────────────────────────────────────────────

const __origGildashStore = { ...require(nodePath.resolve(import.meta.dir, '../../store/gildash.ts')) };
const __origTargetDiscovery = { ...require(nodePath.resolve(import.meta.dir, '../../shared/target-discovery.ts')) };

// ── Mocks ─────────────────────────────────────────────────────────────────────
// Default impls live here once so mock() and the beforeEach restore share one source.
/** A mock implementation that ignores its args and resolves to `value` — both gildash seams share this shape. */
const asyncReturning =
  <T>(value: T) =>
  async (..._args: unknown[]): Promise<T> =>
    value;

const closeImpl = async (_opts?: { cleanup?: boolean }) => {};

// Default empty-async stub impls grouped so the two seams aren't twin const declarations.
const stubImpls = {
  findPattern: asyncReturning<PatternMatch[]>([]),
  resolveTargets: asyncReturning<string[]>([]),
};
const mockClose = mock(closeImpl);
const mockFindPattern = mock(stubImpls.findPattern);
const mockGildash = {
  findPattern: mockFindPattern,
  close: mockClose,
} as unknown as Gildash;

const createGildashImpl = async (_opts: unknown) => mockGildash;

const mockCreateGildash = mock(createGildashImpl);
const mockResolveTargets = mock(stubImpls.resolveTargets);

void mock.module('../../store/gildash', () => ({ createGildash: mockCreateGildash }));
void mock.module('../../shared/target-discovery', () => ({ resolveTargets: mockResolveTargets }));

// ── Import after mock ─────────────────────────────────────────────────────────

import { expectEmptyAndUncalled } from '../../../test/integration/shared/test-kit';
import { createNoopLogger } from '../../shared/logger';
import { findPatternUseCase } from './find-pattern.usecase';

const logger = createNoopLogger('error');
const MATCH_1: PatternMatch = {
  filePath: '/proj/src/a.ts',
  startLine: 3,
  endLine: 3,
  startColumn: 0,
  endColumn: 14,
  startOffset: 0,
  endOffset: 14,
  matchedText: 'console.log(x)',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Arrange: targets resolve to `/a.ts`, but `findPattern` rejects with a GildashError. */
const arrangeFindThrows = (): void => {
  mockResolveTargets.mockImplementation(asyncReturning(['/a.ts']));
  mockFindPattern.mockRejectedValue(new GildashError('search', 'fail'));
};

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockCreateGildash.mockReset();
  mockClose.mockReset();
  mockFindPattern.mockReset();
  mockResolveTargets.mockReset();

  // Restore default implementations
  mockCreateGildash.mockImplementation(createGildashImpl);
  mockClose.mockImplementation(closeImpl);
  mockFindPattern.mockImplementation(stubImpls.findPattern);
  mockResolveTargets.mockImplementation(stubImpls.resolveTargets);
});

afterEach(() => {
  mock.restore();
});

afterAll(() => {
  mock.restore();
  void mock.module(nodePath.resolve(import.meta.dir, '../../store/gildash.ts'), () => __origGildashStore);
  void mock.module(nodePath.resolve(import.meta.dir, '../../shared/target-discovery.ts'), () => __origTargetDiscovery);
});

describe('findPatternUseCase', () => {
  it('should return PatternMatch array when gildash succeeds with 1 match', async () => {
    // Arrange
    mockResolveTargets.mockImplementation(asyncReturning(['/proj/src/a.ts']));
    mockFindPattern.mockImplementation(asyncReturning([MATCH_1]));

    // Act
    const result = await findPatternUseCase({
      targets: ['/proj/src/a.ts'],
      pattern: 'console.log($A)',
      logger,
    });

    // Assert
    expect(result).toEqual([MATCH_1]);
  });

  it('should return empty array when gildash succeeds with 0 matches', async () => {
    // Arrange
    mockResolveTargets.mockImplementation(asyncReturning(['/proj/src/a.ts']));
    mockFindPattern.mockImplementation(asyncReturning([]));

    // Act
    const result = await findPatternUseCase({
      targets: ['/proj/src/a.ts'],
      pattern: '$X = $Y',
      logger,
    });

    // Assert
    expect(result).toEqual([]);
  });

  it('should pass provided rootAbs to createGildash as projectRoot', async () => {
    // Arrange
    mockResolveTargets.mockImplementation(asyncReturning(['/root/a.ts']));
    mockFindPattern.mockImplementation(asyncReturning([]));

    // Act
    await findPatternUseCase({ targets: ['/root/a.ts'], pattern: 'x', logger, rootAbs: '/root' });

    // Assert
    expect(mockCreateGildash).toHaveBeenCalledWith(expect.objectContaining({ projectRoot: '/root' }));
  });

  it('should use process.cwd() as projectRoot when rootAbs is not provided', async () => {
    // Arrange
    mockResolveTargets.mockImplementation(asyncReturning(['/cwd/a.ts']));
    mockFindPattern.mockImplementation(asyncReturning([]));

    const cwdSpy = spyOn(process, 'cwd').mockReturnValue('/cwd');

    // Act
    await findPatternUseCase({ targets: ['/cwd/a.ts'], pattern: 'x', logger });

    // Assert
    expect(mockCreateGildash).toHaveBeenCalledWith(expect.objectContaining({ projectRoot: '/cwd' }));

    cwdSpy.mockRestore();
  });

  it('should pass pattern and filePaths to gildash.findPattern with watchMode false', async () => {
    // Arrange
    const filePaths = ['/proj/a.ts'];

    mockResolveTargets.mockImplementation(asyncReturning(filePaths));
    mockFindPattern.mockImplementation(asyncReturning([]));

    // Act
    await findPatternUseCase({ targets: filePaths, pattern: 'async $F()', logger });

    // Assert
    expect(mockCreateGildash).toHaveBeenCalledWith(expect.objectContaining({ watchMode: false }));
    expect(mockFindPattern).toHaveBeenCalledWith('async $F()', { filePaths });
  });

  it('should call gildash.close with cleanup true on success', async () => {
    // Arrange
    mockResolveTargets.mockImplementation(asyncReturning(['/a.ts']));
    mockFindPattern.mockImplementation(asyncReturning([]));

    // Act
    await findPatternUseCase({ targets: ['/a.ts'], pattern: 'x', logger });

    // Assert
    expect(mockClose).toHaveBeenCalledWith({ cleanup: true });
  });

  it('should return empty array and not create gildash when targets resolves to empty', async () => {
    // Arrange
    mockResolveTargets.mockImplementation(asyncReturning([]));

    // Act
    const result = await findPatternUseCase({ targets: [], pattern: 'x', logger });

    // Assert
    expectEmptyAndUncalled(result, mockCreateGildash);
  });

  it('should not call gildash.close when filePaths is empty (early return path)', async () => {
    // Arrange
    mockResolveTargets.mockImplementation(asyncReturning([]));

    // Act
    await findPatternUseCase({ targets: [], pattern: 'x', logger });

    // Assert
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('should call resolveTargets with root and undefined when targets is not provided', async () => {
    // Arrange
    mockResolveTargets.mockImplementation(asyncReturning([]));

    const cwdSpy = spyOn(process, 'cwd').mockReturnValue('/cwd');

    // Act
    await findPatternUseCase({ pattern: 'x', logger });

    // Assert
    expect(mockResolveTargets).toHaveBeenCalledWith('/cwd', undefined);

    cwdSpy.mockRestore();
  });

  it('should return empty array when gildash.findPattern throws GildashError', async () => {
    // Arrange
    arrangeFindThrows();

    // Act
    const result = await findPatternUseCase({ targets: ['/a.ts'], pattern: 'x', logger });

    // Assert
    expect(result).toEqual([]);
  });

  it('should call gildash.close even when gildash.findPattern throws GildashError', async () => {
    // Arrange
    arrangeFindThrows();

    // Act
    await findPatternUseCase({ targets: ['/a.ts'], pattern: 'x', logger });

    // Assert
    expect(mockClose).toHaveBeenCalledWith({ cleanup: true });
  });

  it('should propagate error when createGildash throws', async () => {
    // Arrange
    mockResolveTargets.mockImplementation(asyncReturning(['/a.ts']));
    mockCreateGildash.mockImplementation(async () => {
      throw new Error('open failed');
    });

    // Act & Assert
    await expect(findPatternUseCase({ targets: ['/a.ts'], pattern: 'x', logger })).rejects.toThrow('open failed');
  });

  it('should propagate error when resolveTargets throws', async () => {
    // Arrange
    mockResolveTargets.mockImplementation(async () => {
      throw new Error('resolve failed');
    });

    // Act & Assert
    await expect(findPatternUseCase({ targets: ['/a.ts'], pattern: 'x', logger })).rejects.toThrow('resolve failed');
  });

  it('should return early with empty array and call nothing when targets=[] and rootAbs=undefined', async () => {
    // Arrange
    mockResolveTargets.mockImplementation(asyncReturning([]));

    // Act
    const result = await findPatternUseCase({ targets: [], pattern: 'x', logger });

    // Assert
    expectEmptyAndUncalled(result, mockCreateGildash);
    expect(mockFindPattern).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('should return same result on repeated calls with identical input', async () => {
    // Arrange
    mockResolveTargets.mockImplementation(asyncReturning(['/a.ts']));
    mockFindPattern.mockImplementation(asyncReturning([MATCH_1]));

    // Act
    const result1 = await findPatternUseCase({ targets: ['/a.ts'], pattern: 'x', logger });
    const result2 = await findPatternUseCase({ targets: ['/a.ts'], pattern: 'x', logger });

    // Assert
    expect(result1).toEqual(result2);
  });
});
