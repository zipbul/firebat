import { mock, describe, it, expect, beforeEach, afterEach, spyOn } from 'bun:test';

import type { Gildash } from '@zipbul/gildash';
import type { PatternMatch } from '@zipbul/gildash';
import { err } from '@zipbul/result';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockClose = mock(async (_opts?: { cleanup?: boolean }) => {});
const mockFindPattern = mock(
  async (_pattern: string, _opts?: { filePaths?: string[] }): Promise<PatternMatch[]> => [],
);

const mockGildash = {
  findPattern: mockFindPattern,
  close: mockClose,
} as unknown as Gildash;

const mockCreateGildash = mock(async (_opts: unknown) => mockGildash);
const mockResolveTargets = mock(
  async (_root: string, _targets?: ReadonlyArray<string>): Promise<string[]> => [],
);

mock.module('../../store/gildash', () => ({ createGildash: mockCreateGildash }));
mock.module('../../shared/target-discovery', () => ({ resolveTargets: mockResolveTargets }));

// ── Import after mock ─────────────────────────────────────────────────────────

import { findPatternUseCase } from './find-pattern.usecase';
import { createNoopLogger } from '../../shared/logger';

const logger = createNoopLogger('error');

const MATCH_1: PatternMatch = {
  filePath: '/proj/src/a.ts',
  startLine: 3,
  endLine: 3,
  matchedText: 'console.log(x)',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const resolveToFiles =
  (files: string[]) =>
  async (_root: string, _targets?: ReadonlyArray<string>): Promise<string[]> =>
    files;

const findPatternReturnsOk =
  (matches: PatternMatch[]) =>
  async (_pattern: string, _opts?: { filePaths?: string[] }): Promise<PatternMatch[]> =>
    matches;

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockCreateGildash.mockReset();
  mockClose.mockReset();
  mockFindPattern.mockReset();
  mockResolveTargets.mockReset();

  // Restore default implementations
  mockCreateGildash.mockImplementation(async (_opts: unknown) => mockGildash);
  mockClose.mockImplementation(async (_opts?: { cleanup?: boolean }) => {});
  mockFindPattern.mockImplementation(
    async (_pattern: string, _opts?: { filePaths?: string[] }): Promise<PatternMatch[]> => [],
  );
  mockResolveTargets.mockImplementation(
    async (_root: string, _targets?: ReadonlyArray<string>): Promise<string[]> => [],
  );
});

afterEach(() => {
  mock.restore();
});

describe('findPatternUseCase', () => {
  it('should return PatternMatch array when gildash succeeds with 1 match', async () => {
    // Arrange
    mockResolveTargets.mockImplementation(resolveToFiles(['/proj/src/a.ts']));
    mockFindPattern.mockImplementation(findPatternReturnsOk([MATCH_1]));

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
    mockResolveTargets.mockImplementation(resolveToFiles(['/proj/src/a.ts']));
    mockFindPattern.mockImplementation(findPatternReturnsOk([]));

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
    mockResolveTargets.mockImplementation(resolveToFiles(['/root/a.ts']));
    mockFindPattern.mockImplementation(findPatternReturnsOk([]));

    // Act
    await findPatternUseCase({ targets: ['/root/a.ts'], pattern: 'x', logger, rootAbs: '/root' });

    // Assert
    expect(mockCreateGildash).toHaveBeenCalledWith(
      expect.objectContaining({ projectRoot: '/root' }),
    );
  });

  it('should use process.cwd() as projectRoot when rootAbs is not provided', async () => {
    // Arrange
    mockResolveTargets.mockImplementation(resolveToFiles(['/cwd/a.ts']));
    mockFindPattern.mockImplementation(findPatternReturnsOk([]));
    const cwdSpy = spyOn(process, 'cwd').mockReturnValue('/cwd');

    // Act
    await findPatternUseCase({ targets: ['/cwd/a.ts'], pattern: 'x', logger });

    // Assert
    expect(mockCreateGildash).toHaveBeenCalledWith(
      expect.objectContaining({ projectRoot: '/cwd' }),
    );

    cwdSpy.mockRestore();
  });

  it('should pass pattern and filePaths to gildash.findPattern with watchMode false', async () => {
    // Arrange
    const filePaths = ['/proj/a.ts'];
    mockResolveTargets.mockImplementation(resolveToFiles(filePaths));
    mockFindPattern.mockImplementation(findPatternReturnsOk([]));

    // Act
    await findPatternUseCase({ targets: filePaths, pattern: 'async $F()', logger });

    // Assert
    expect(mockCreateGildash).toHaveBeenCalledWith(
      expect.objectContaining({ watchMode: false }),
    );
    expect(mockFindPattern).toHaveBeenCalledWith('async $F()', { filePaths });
  });

  it('should call gildash.close with cleanup true on success', async () => {
    // Arrange
    mockResolveTargets.mockImplementation(resolveToFiles(['/a.ts']));
    mockFindPattern.mockImplementation(findPatternReturnsOk([]));

    // Act
    await findPatternUseCase({ targets: ['/a.ts'], pattern: 'x', logger });

    // Assert
    expect(mockClose).toHaveBeenCalledWith({ cleanup: true });
  });

  it('should return empty array and not create gildash when targets resolves to empty', async () => {
    // Arrange
    mockResolveTargets.mockImplementation(resolveToFiles([]));

    // Act
    const result = await findPatternUseCase({ targets: [], pattern: 'x', logger });

    // Assert
    expect(result).toEqual([]);
    expect(mockCreateGildash).not.toHaveBeenCalled();
  });

  it('should not call gildash.close when filePaths is empty (early return path)', async () => {
    // Arrange
    mockResolveTargets.mockImplementation(resolveToFiles([]));

    // Act
    await findPatternUseCase({ targets: [], pattern: 'x', logger });

    // Assert
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('should call resolveTargets with root and undefined when targets is not provided', async () => {
    // Arrange
    mockResolveTargets.mockImplementation(resolveToFiles([]));
    const cwdSpy = spyOn(process, 'cwd').mockReturnValue('/cwd');

    // Act
    await findPatternUseCase({ pattern: 'x', logger });

    // Assert
    expect(mockResolveTargets).toHaveBeenCalledWith('/cwd', undefined);

    cwdSpy.mockRestore();
  });

  it('should return empty array when gildash.findPattern returns Err', async () => {
    // Arrange
    mockResolveTargets.mockImplementation(resolveToFiles(['/a.ts']));
    mockFindPattern.mockImplementation(
      async () => err({ type: 'search' as const, message: 'fail' }) as unknown as PatternMatch[],
    );

    // Act
    const result = await findPatternUseCase({ targets: ['/a.ts'], pattern: 'x', logger });

    // Assert
    expect(result).toEqual([]);
  });

  it('should call gildash.close even when gildash.findPattern returns Err', async () => {
    // Arrange
    mockResolveTargets.mockImplementation(resolveToFiles(['/a.ts']));
    mockFindPattern.mockImplementation(
      async () => err({ type: 'search' as const, message: 'fail' }) as unknown as PatternMatch[],
    );

    // Act
    await findPatternUseCase({ targets: ['/a.ts'], pattern: 'x', logger });

    // Assert
    expect(mockClose).toHaveBeenCalledWith({ cleanup: true });
  });

  it('should propagate error when createGildash throws', async () => {
    // Arrange
    mockResolveTargets.mockImplementation(resolveToFiles(['/a.ts']));
    mockCreateGildash.mockImplementation(async () => {
      throw new Error('open failed');
    });

    // Act & Assert
    await expect(
      findPatternUseCase({ targets: ['/a.ts'], pattern: 'x', logger }),
    ).rejects.toThrow('open failed');
  });

  it('should propagate error when resolveTargets throws', async () => {
    // Arrange
    mockResolveTargets.mockImplementation(async () => {
      throw new Error('resolve failed');
    });

    // Act & Assert
    await expect(
      findPatternUseCase({ targets: ['/a.ts'], pattern: 'x', logger }),
    ).rejects.toThrow('resolve failed');
  });

  it('should return early with empty array and call nothing when targets=[] and rootAbs=undefined', async () => {
    // Arrange
    mockResolveTargets.mockImplementation(resolveToFiles([]));

    // Act
    const result = await findPatternUseCase({ targets: [], pattern: 'x', logger });

    // Assert
    expect(result).toEqual([]);
    expect(mockCreateGildash).not.toHaveBeenCalled();
    expect(mockFindPattern).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
  });

  it('should return same result on repeated calls with identical input', async () => {
    // Arrange
    mockResolveTargets.mockImplementation(resolveToFiles(['/a.ts']));
    mockFindPattern.mockImplementation(findPatternReturnsOk([MATCH_1]));

    // Act
    const result1 = await findPatternUseCase({ targets: ['/a.ts'], pattern: 'x', logger });
    const result2 = await findPatternUseCase({ targets: ['/a.ts'], pattern: 'x', logger });

    // Assert
    expect(result1).toEqual(result2);
  });
});
