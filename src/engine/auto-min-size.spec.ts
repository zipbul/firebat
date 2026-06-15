import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as path from 'node:path';

import type { ParsedFile } from './types';

interface PercentileCase { name: string; fileCount: number; lowCount: number }
interface ClampCase { name: string; sizeReturn: number; expected: number }

// ── Mocks (must be set up before the SUT module is imported) ──────────────────

const duplicateDetectorAbs = path.resolve(import.meta.dir, '../features/duplicates/analyzer.ts');
const oxcAstUtilsAbs = path.resolve(import.meta.dir, './ast/oxc-ast-utils.ts');
const oxcSizeCountAbs = path.resolve(import.meta.dir, './ast/oxc-size-count.ts');
// Save original modules BEFORE any mock.module() calls (shallow snapshot to avoid live binding mutation)
const __origDuplicateDetector = { ...require(duplicateDetectorAbs) };
const __origOxcAstUtils = { ...require(oxcAstUtilsAbs) };
const __origOxcSizeCount = { ...require(oxcSizeCountAbs) };
const isCloneTargetMock = mock((_node: unknown) => true);
const collectOxcNodesMock = mock((_program: unknown, _pred: unknown): unknown[] => []);
const countOxcSizeMock = mock((_node: unknown): number => 50);

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeFile = (errorCount = 0): ParsedFile =>
  ({
    filePath: 'test.ts',
    sourceText: '',
    program: {} as ParsedFile['program'],
    errors: Array.from({ length: errorCount }, () => ({})),
  }) as unknown as ParsedFile;

/** Build N dummy file objects, all error-free. */
const makeFiles = (count: number): ParsedFile[] => Array.from({ length: count }, () => makeFile(0));

// ── computeAutoMinSize ────────────────────────────────────────────────────────

describe('computeAutoMinSize', () => {
  beforeAll(() => {
    void mock.module(duplicateDetectorAbs, () => ({ isCloneTarget: isCloneTargetMock }));
    void mock.module(oxcAstUtilsAbs, () => ({ collectOxcNodes: collectOxcNodesMock }));
    void mock.module(oxcSizeCountAbs, () => ({ countOxcSize: countOxcSizeMock }));
  });

  beforeEach(() => {
    isCloneTargetMock.mockClear();
    // By default, each file yields one node with size 50.
    collectOxcNodesMock.mockImplementation(() => [{}]);
    countOxcSizeMock.mockImplementation(() => 50);
  });

  it('should return 60 when files array is empty', async () => {
    // Arrange
    const { computeAutoMinSize } = await import('./auto-min-size');
    // Act
    const result = computeAutoMinSize([]);

    // Assert
    expect(result).toBe(60);
  });

  it('should return 60 when all files have errors', async () => {
    // Arrange
    const { computeAutoMinSize } = await import('./auto-min-size');

    collectOxcNodesMock.mockImplementation(() => []);

    // Act
    const result = computeAutoMinSize([makeFile(1), makeFile(2)]);

    // Assert
    expect(result).toBe(60);
  });

  it('should only include sizes from files without errors when mixed', async () => {
    // Arrange
    const { computeAutoMinSize } = await import('./auto-min-size');

    countOxcSizeMock.mockReturnValue(100);

    // error file should be skipped, healthy file contributes size=100
    const files = [makeFile(1), makeFile(0)];
    // Act
    const result = computeAutoMinSize(files);

    // Assert — must be inside [10,200] based on size=100
    expect(result).toBeGreaterThanOrEqual(10);
    expect(result).toBeLessThanOrEqual(200);
    expect(result).toBe(100); // median of [100] is 100
  });

  it('should use percentile 0.5 (median) when fileCount is less than 500', async () => {
    // Arrange
    const { computeAutoMinSize } = await import('./auto-min-size');
    // counts=[10,20,30,40,50], median index=2 → value=30
    const calls = [10, 20, 30, 40, 50];
    let i = 0;

    collectOxcNodesMock.mockImplementation(() => [{}]);
    countOxcSizeMock.mockImplementation(() => calls[i++ % calls.length] ?? 50);

    // Act
    const result = computeAutoMinSize(makeFiles(5));

    // Assert — median (index 2 of sorted [10,20,30,40,50]) = 30
    expect(result).toBe(30);
  });

  // Percentile boundaries: a bimodal size distribution (lowCount nodes → 15, rest → 25)
  // sized so the chosen percentile index lands in the high (25) band, while p=0.5 would
  // land in the low (15) band — proving the file-count→percentile mapping.
  const percentileCases: PercentileCase[] = [
    // p=0.6 at 500 files: index=floor(499*0.6)=299 → 25 (p=0.5 → 249 → 15)
    { name: 'should use percentile 0.6 when fileCount is exactly 500', fileCount: 500, lowCount: 270 },
    // p=0.75 at 1000 files: index=floor(999*0.75)=749 → 25 (p=0.5 → 499 → 15)
    { name: 'should use percentile 0.75 when fileCount is exactly 1000', fileCount: 1000, lowCount: 500 },
  ];

  it.each(percentileCases)('$name', async ({ fileCount, lowCount }) => {
    const { computeAutoMinSize } = await import('./auto-min-size');
    let callIdx = 0;

    countOxcSizeMock.mockImplementation(() => (++callIdx <= lowCount ? 15 : 25));

    const result = computeAutoMinSize(makeFiles(fileCount));

    expect(result).toBe(25);
  });

  // Result is clamped into [10, 200] regardless of the raw percentile value.
  const clampCases: ClampCase[] = [
    { name: 'should clamp result to minimum 10 when computed value is below 10', sizeReturn: 1, expected: 10 },
    { name: 'should clamp result to maximum 200 when computed value is above 200', sizeReturn: 9999, expected: 200 },
  ];

  it.each(clampCases)('$name', async ({ sizeReturn, expected }) => {
    const { computeAutoMinSize } = await import('./auto-min-size');

    countOxcSizeMock.mockReturnValue(sizeReturn);

    const result = computeAutoMinSize([makeFile(0)]);

    expect(result).toBe(expected);
  });

  it('should return a value within [10, 200] for normal input', async () => {
    // Arrange
    const { computeAutoMinSize } = await import('./auto-min-size');

    countOxcSizeMock.mockReturnValue(80);

    // Act
    const result = computeAutoMinSize(makeFiles(3));

    // Assert
    expect(result).toBeGreaterThanOrEqual(10);
    expect(result).toBeLessThanOrEqual(200);
  });

  it('should return the same result on two successive calls with the same input', async () => {
    // Arrange
    const { computeAutoMinSize } = await import('./auto-min-size');

    countOxcSizeMock.mockReturnValue(50);

    const files = makeFiles(2);
    // Act
    const first = computeAutoMinSize(files);
    const second = computeAutoMinSize(files);

    // Assert
    expect(first).toBe(second);
  });

  it('should return 60 when a file has no clone-target nodes', async () => {
    // Arrange
    const { computeAutoMinSize } = await import('./auto-min-size');

    collectOxcNodesMock.mockReturnValue([]); // no nodes → no sizes

    // Act
    const result = computeAutoMinSize([makeFile(0)]);

    // Assert
    expect(result).toBe(60);
  });

  afterAll(() => {
    mock.restore();
    // Re-register original modules to prevent mock.module contamination of subsequent test files
    void mock.module(duplicateDetectorAbs, () => __origDuplicateDetector);
    void mock.module(oxcAstUtilsAbs, () => __origOxcAstUtils);
    void mock.module(oxcSizeCountAbs, () => __origOxcSizeCount);
  });
});
