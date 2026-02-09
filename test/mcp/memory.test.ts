import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

import { createMcpTestContext, callTool, callToolSafe, type McpTestContext } from './helpers/mcp-client';

let ctx: McpTestContext;

beforeAll(async () => {
  ctx = await createMcpTestContext({});
}, 30_000);

afterAll(async () => {
  await ctx?.close();
});

describe('memory tools (write → read → list → delete)', () => {
  // -----------------------------------------------------------------------
  // write_memory
  // -----------------------------------------------------------------------

  test('should write a simple string value', async () => {
    // Arrange & Act
    const { structured } = await callTool(ctx.client, 'write_memory', {
      memoryKey: 'test-string',
      value: 'hello world',
    });

    // Assert
    expect(structured.ok).toBe(true);
    expect(structured.memoryKey).toBe('test-string');
  }, 30_000);

  test('should write a number value', async () => {
    // Arrange & Act
    const { structured } = await callTool(ctx.client, 'write_memory', {
      memoryKey: 'test-number',
      value: 42,
    });

    // Assert
    expect(structured.ok).toBe(true);
  }, 30_000);

  test('should write a complex JSON object', async () => {
    // Arrange & Act
    const { structured } = await callTool(ctx.client, 'write_memory', {
      memoryKey: 'test-complex',
      value: {
        nested: { deeply: { value: [1, 2, 3] } },
        tags: ['a', 'b', 'c'],
        metadata: { count: 99, active: true },
      },
    });

    // Assert
    expect(structured.ok).toBe(true);
  }, 30_000);

  test('should write a null value', async () => {
    // Arrange & Act
    const { structured } = await callTool(ctx.client, 'write_memory', {
      memoryKey: 'test-null',
      value: null,
    });

    // Assert
    expect(structured.ok).toBe(true);
  }, 30_000);

  test('should write a boolean value', async () => {
    // Arrange & Act
    const { structured } = await callTool(ctx.client, 'write_memory', {
      memoryKey: 'test-bool',
      value: true,
    });

    // Assert
    expect(structured.ok).toBe(true);
  }, 30_000);

  test('should write an array value', async () => {
    // Arrange & Act
    const { structured } = await callTool(ctx.client, 'write_memory', {
      memoryKey: 'test-array',
      value: [1, 'two', null, { four: 4 }],
    });

    // Assert
    expect(structured.ok).toBe(true);
  }, 30_000);

  test('should overwrite an existing key', async () => {
    // Arrange
    await callTool(ctx.client, 'write_memory', {
      memoryKey: 'overwrite-me',
      value: 'original',
    });

    // Act
    const { structured } = await callTool(ctx.client, 'write_memory', {
      memoryKey: 'overwrite-me',
      value: 'replaced',
    });

    // Assert
    expect(structured.ok).toBe(true);

    // Verify
    const { structured: read } = await callTool(ctx.client, 'read_memory', {
      memoryKey: 'overwrite-me',
    });

    expect(read.found).toBe(true);
    expect(read.value).toBe('replaced');
  }, 30_000);

  test('should handle key with special characters', async () => {
    // Arrange & Act
    const { structured } = await callTool(ctx.client, 'write_memory', {
      memoryKey: 'special/key:with.dots-and_underscores!@#',
      value: 'special-value',
    });

    // Assert
    expect(structured.ok).toBe(true);
  }, 30_000);

  test('should handle very long key', async () => {
    // Arrange & Act
    const longKey = 'k'.repeat(500);
    const { structured } = await callTool(ctx.client, 'write_memory', {
      memoryKey: longKey,
      value: 'long-key-value',
    });

    // Assert
    expect(structured.ok).toBe(true);
  }, 30_000);

  test('should handle large value', async () => {
    // Arrange & Act
    const largeValue = { data: 'x'.repeat(10_000), items: Array.from({ length: 100 }, (_, i) => i) };
    const { structured } = await callTool(ctx.client, 'write_memory', {
      memoryKey: 'test-large',
      value: largeValue,
    });

    // Assert
    expect(structured.ok).toBe(true);
  }, 30_000);

  // -----------------------------------------------------------------------
  // read_memory
  // -----------------------------------------------------------------------

  test('should read a previously written value', async () => {
    // Arrange – written above as 'test-string'

    // Act
    const { structured } = await callTool(ctx.client, 'read_memory', {
      memoryKey: 'test-string',
    });

    // Assert
    expect(structured.found).toBe(true);
    expect(structured.memoryKey).toBe('test-string');
    expect(structured.value).toBe('hello world');
  }, 30_000);

  test('should read a complex JSON value', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'read_memory', {
      memoryKey: 'test-complex',
    });

    // Assert
    expect(structured.found).toBe(true);
    expect(structured.value.nested.deeply.value).toEqual([1, 2, 3]);
    expect(structured.value.tags).toEqual(['a', 'b', 'c']);
  }, 30_000);

  test('should return found=false for non-existent key', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'read_memory', {
      memoryKey: 'does-not-exist',
    });

    // Assert
    expect(structured.found).toBe(false);
    expect(structured.memoryKey).toBe('does-not-exist');
  }, 30_000);

  test('should read null value correctly', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'read_memory', {
      memoryKey: 'test-null',
    });

    // Assert
    expect(structured.found).toBe(true);
    expect(structured.value).toBeNull();
  }, 30_000);

  test('should read array value correctly', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'read_memory', {
      memoryKey: 'test-array',
    });

    // Assert
    expect(structured.found).toBe(true);
    expect(Array.isArray(structured.value)).toBe(true);
    expect(structured.value.length).toBe(4);
  }, 30_000);

  test('should read key with special characters', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'read_memory', {
      memoryKey: 'special/key:with.dots-and_underscores!@#',
    });

    // Assert
    expect(structured.found).toBe(true);
    expect(structured.value).toBe('special-value');
  }, 30_000);

  // -----------------------------------------------------------------------
  // list_memories
  // -----------------------------------------------------------------------

  test('should list all written memory keys', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'list_memories', {});

    // Assert
    expect(Array.isArray(structured.memories)).toBe(true);
    expect(structured.memories.length).toBeGreaterThan(0);

    const keys = structured.memories.map((m: any) => m.memoryKey);

    expect(keys).toContain('test-string');
    expect(keys).toContain('test-number');
    expect(keys).toContain('test-complex');
  }, 30_000);

  test('should include updatedAt in list results', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'list_memories', {});

    // Assert
    for (const memory of structured.memories) {
      expect(typeof memory.memoryKey).toBe('string');
      expect(typeof memory.updatedAt).toBe('number');
    }
  }, 30_000);

  // -----------------------------------------------------------------------
  // delete_memory
  // -----------------------------------------------------------------------

  test('should delete an existing memory key', async () => {
    // Arrange – write a key to delete
    await callTool(ctx.client, 'write_memory', {
      memoryKey: 'to-delete',
      value: 'temporary',
    });

    // Act
    const { structured } = await callTool(ctx.client, 'delete_memory', {
      memoryKey: 'to-delete',
    });

    // Assert
    expect(structured.ok).toBe(true);
    expect(structured.memoryKey).toBe('to-delete');

    // Verify it's gone
    const { structured: read } = await callTool(ctx.client, 'read_memory', {
      memoryKey: 'to-delete',
    });

    expect(read.found).toBe(false);
  }, 30_000);

  test('should return ok=true even for non-existent key', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'delete_memory', {
      memoryKey: 'never-existed',
    });

    // Assert
    expect(structured.ok).toBe(true);
  }, 30_000);

  test('should handle delete then re-write of same key', async () => {
    // Arrange
    await callTool(ctx.client, 'write_memory', { memoryKey: 'cycle-key', value: 'v1' });
    await callTool(ctx.client, 'delete_memory', { memoryKey: 'cycle-key' });
    await callTool(ctx.client, 'write_memory', { memoryKey: 'cycle-key', value: 'v2' });

    // Act
    const { structured } = await callTool(ctx.client, 'read_memory', {
      memoryKey: 'cycle-key',
    });

    // Assert
    expect(structured.found).toBe(true);
    expect(structured.value).toBe('v2');
  }, 30_000);

  // -----------------------------------------------------------------------
  // Stress: rapid sequential writes
  // -----------------------------------------------------------------------

  test('should handle 20 rapid sequential write/read cycles', async () => {
    // Act & Assert
    for (let i = 0; i < 20; i++) {
      const key = `stress-${i}`;
      const value = { iteration: i, data: `value-${i}` };

      await callTool(ctx.client, 'write_memory', { memoryKey: key, value });

      const { structured } = await callTool(ctx.client, 'read_memory', { memoryKey: key });

      expect(structured.found).toBe(true);
      expect(structured.value.iteration).toBe(i);
    }
  }, 60_000);

  test('should handle bulk write then bulk read', async () => {
    // Arrange – write 10 keys
    for (let i = 0; i < 10; i++) {
      await callTool(ctx.client, 'write_memory', {
        memoryKey: `bulk-${i}`,
        value: i * 100,
      });
    }

    // Act – read all 10
    for (let i = 0; i < 10; i++) {
      const { structured } = await callTool(ctx.client, 'read_memory', {
        memoryKey: `bulk-${i}`,
      });

      // Assert
      expect(structured.found).toBe(true);
      expect(structured.value).toBe(i * 100);
    }
  }, 60_000);
});
