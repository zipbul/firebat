import { describe, expect, it } from 'bun:test';

import { WriteBehindQueue } from './write-behind-queue';

describe('WriteBehindQueue', () => {
  it('should execute an enqueued job after flush', async () => {
    // Arrange
    const queue = new WriteBehindQueue();
    let ran = false;

    // Act
    queue.enqueue(() => {
      ran = true;
    });
    await queue.flush();

    // Assert
    expect(ran).toBe(true);
  });

  it('should execute multiple jobs in enqueue order', async () => {
    // Arrange
    const queue = new WriteBehindQueue();
    const order: number[] = [];

    // Act
    queue.enqueue(() => order.push(1));
    queue.enqueue(() => order.push(2));
    queue.enqueue(() => order.push(3));
    await queue.flush();

    // Assert
    expect(order).toEqual([1, 2, 3]);
  });

  it('should decrement getPendingCount to 0 after flush', async () => {
    // Arrange
    const queue = new WriteBehindQueue();

    // Act
    queue.enqueue(() => {});
    queue.enqueue(() => {});
    await queue.flush();

    // Assert
    expect(queue.getPendingCount()).toBe(0);
  });

  it('should capture the Error thrown by a job in getLastError', async () => {
    // Arrange
    const queue = new WriteBehindQueue();
    const boom = new Error('boom');

    // Act
    queue.enqueue(() => {
      throw boom;
    });
    await queue.flush();

    // Assert
    expect(queue.getLastError()).toBe(boom);
  });

  it('should wrap a non-Error throw in an Error and store it in getLastError', async () => {
    // Arrange
    const queue = new WriteBehindQueue();

    // Act
    queue.enqueue(() => {
      throw 'string error';
    });
    await queue.flush();

    // Assert
    expect(queue.getLastError()).toBeInstanceOf(Error);
    expect(queue.getLastError()?.message).toContain('string error');
  });

  it('should resolve flush when timeoutMs is provided and work completes in time', async () => {
    // Arrange
    const queue = new WriteBehindQueue();
    let done = false;
    queue.enqueue(() => {
      done = true;
    });

    // Act
    await queue.flush(500);

    // Assert
    expect(done).toBe(true);
  });

  it('should return immediately when flush timeoutMs is 0', async () => {
    // Arrange
    const queue = new WriteBehindQueue();
    let ran = false;
    queue.enqueue(() => {
      ran = true;
    });

    // Act
    const start = Date.now();
    await queue.flush(0);
    const elapsed = Date.now() - start;

    // Assert — flush(0) returns immediately without waiting
    expect(elapsed).toBeLessThan(100);
    // ran may or may not be true depending on timing — we only check elapsed
  });

  it('should return null from getLastError when no job has thrown', () => {
    // Arrange
    const queue = new WriteBehindQueue();

    // Act & Assert
    expect(queue.getLastError()).toBeNull();
  });

  it('should resolve flush with no timeout after all jobs complete', async () => {
    // Arrange
    const queue = new WriteBehindQueue();
    const results: string[] = [];
    queue.enqueue(() => results.push('a'));
    queue.enqueue(() => results.push('b'));

    // Act
    await queue.flush();

    // Assert
    expect(results).toEqual(['a', 'b']);
  });
});
