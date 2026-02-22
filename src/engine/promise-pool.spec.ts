import { describe, expect, it, mock } from 'bun:test';

import { runWithConcurrency } from './promise-pool';

describe('runWithConcurrency', () => {
  it('should call the worker for every item in the array', async () => {
    // Arrange
    const items = [1, 2, 3];
    const processed: number[] = [];
    const worker = async (item: number): Promise<void> => {
      processed.push(item);
    };

    // Act
    await runWithConcurrency(items, 3, worker);

    // Assert
    expect(processed.sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('should process items sequentially when concurrency is 1', async () => {
    // Arrange
    const items = [10, 20, 30];
    const order: number[] = [];
    const worker = async (item: number): Promise<void> => {
      order.push(item);
    };

    // Act
    await runWithConcurrency(items, 1, worker);

    // Assert
    expect(order).toEqual([10, 20, 30]);
  });

  it('should clamp concurrency to 1 when value is less than 1', async () => {
    // Arrange
    const items = [1, 2, 3];
    const calls: number[] = [];
    const worker = async (item: number): Promise<void> => {
      calls.push(item);
    };

    // Act — concurrency=0 should be clamped to 1
    await runWithConcurrency(items, 0, worker);

    // Assert — all items processed (sequential)
    expect(calls.sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('should not call the worker when items array is empty', async () => {
    // Arrange
    const worker = mock(async () => {});

    // Act
    await runWithConcurrency([], 4, worker);

    // Assert
    expect(worker).not.toHaveBeenCalled();
  });

  it('should handle concurrency greater than items length without error', async () => {
    // Arrange: 2 items but concurrency=10 → only 2 runners launched
    const items = ['a', 'b'];
    const processed: string[] = [];
    const worker = async (item: string): Promise<void> => {
      processed.push(item);
    };

    // Act & Assert
    await expect(runWithConcurrency(items, 10, worker)).resolves.toBeUndefined();
    expect(processed.sort()).toEqual(['a', 'b']);
  });

  it('should await all workers before resolving', async () => {
    // Arrange: workers have staggered delays
    const results: string[] = [];
    const worker = async (label: string): Promise<void> => {
      await new Promise<void>(resolve => setTimeout(resolve, 1));
      results.push(label);
    };

    // Act
    await runWithConcurrency(['x', 'y', 'z'], 3, worker);

    // Assert — all resolved by the time runWithConcurrency returns
    expect(results.length).toBe(3);
  });

  it('should produce the same outcome on two successive calls with identical inputs', async () => {
    // Arrange
    const sums: number[] = [];
    const worker = async (n: number): Promise<void> => {
      sums.push(n * 2);
    };

    // Act
    await runWithConcurrency([1, 2, 3], 2, worker);
    const firstRun = [...sums].sort();
    sums.length = 0;
    await runWithConcurrency([1, 2, 3], 2, worker);
    const secondRun = [...sums].sort();

    // Assert
    expect(firstRun).toEqual(secondRun);
  });

  it('should clamp fractional concurrency via Math.floor', async () => {
    // Arrange: concurrency=1.9 → floor=1 → sequential
    const order: number[] = [];
    const worker = async (item: number): Promise<void> => {
      order.push(item);
    };

    // Act
    await runWithConcurrency([1, 2, 3], 1.9, worker);

    // Assert — sequential order preserved
    expect(order).toEqual([1, 2, 3]);
  });
});
