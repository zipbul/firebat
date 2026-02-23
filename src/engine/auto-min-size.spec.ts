import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import * as path from 'node:path';

import type { ParsedFile } from './types';

// ── Mocks (must be set up before the SUT module is imported) ──────────────────

const duplicateDetectorAbs = path.resolve(import.meta.dir, './duplicate-detector.ts');
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
const makeFiles = (count: number): ParsedFile[] =>
  Array.from({ length: count }, () => makeFile(0));

// ── computeAutoMinSize ────────────────────────────────────────────────────────

describe('computeAutoMinSize', () => {
  beforeAll(() => {
    mock.module(duplicateDetectorAbs, () => ({ isCloneTarget: isCloneTargetMock }));
    mock.module(oxcAstUtilsAbs, () => ({ collectOxcNodes: collectOxcNodesMock }));
    mock.module(oxcSizeCountAbs, () => ({ countOxcSize: countOxcSizeMock }));
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

  it('should use percentile 0.6 when fileCount is exactly 500', async () => {
    // Arrange
    const { computeAutoMinSize } = await import('./auto-min-size');
    // 500 files: first 270 nodes → size=15, last 230 → size=25.
    // sorted counts: [15 x270, 25 x230]
    // p=0.6: index=floor(499*0.6)=299 → counts[299]=25
    // p=0.5 would give index=249 → counts[249]=15 (distinguishable)
    let callIdx = 0;
    countOxcSizeMock.mockImplementation(() => ++callIdx <= 270 ? 15 : 25);

    // Act
    const result = computeAutoMinSize(makeFiles(500));

    // Assert
    expect(result).toBe(25);
  });

  it('should use percentile 0.75 when fileCount is exactly 1000', async () => {
    // Arrange
    const { computeAutoMinSize } = await import('./auto-min-size');
    // 1000 files: first 500 → size=15, last 500 → size=25.
    // sorted counts: [15 x500, 25 x500]
    // p=0.75: index=floor(999*0.75)=749 → counts[749]=25
    // p=0.5 would give index=499 → counts[499]=15 (distinguishable)
    let callIdx = 0;
    countOxcSizeMock.mockImplementation(() => ++callIdx <= 500 ? 15 : 25);

    // Act
    const result = computeAutoMinSize(makeFiles(1000));

    // Assert
    expect(result).toBe(25);
  });

  it('should clamp result to minimum 10 when computed value is below 10', async () => {
    // Arrange
    const { computeAutoMinSize } = await import('./auto-min-size');
    countOxcSizeMock.mockReturnValue(1); // very small sizes

    // Act
    const result = computeAutoMinSize([makeFile(0)]);

    // Assert
    expect(result).toBe(10);
  });

  it('should clamp result to maximum 200 when computed value is above 200', async () => {
    // Arrange
    const { computeAutoMinSize } = await import('./auto-min-size');
    countOxcSizeMock.mockReturnValue(9999); // very large size

    // Act
    const result = computeAutoMinSize([makeFile(0)]);

    // Assert
    expect(result).toBe(200);
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
    mock.module(duplicateDetectorAbs, () => __origDuplicateDetector);
    mock.module(oxcAstUtilsAbs, () => __origOxcAstUtils);
    mock.module(oxcSizeCountAbs, () => __origOxcSizeCount);
  });
});
