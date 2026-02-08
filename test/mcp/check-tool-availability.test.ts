import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createMcpTestContext, callTool, type McpTestContext } from './helpers/mcp-client';

let ctx: McpTestContext;

beforeAll(async () => {
  ctx = await createMcpTestContext({});
}, 30_000);

afterAll(async () => {
  await ctx?.close();
});

describe('check_tool_availability', () => {
  test('should return availability status for all tools', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'check_tool_availability', {
      root: ctx.tmpRootAbs,
    });

    // Assert — each tool is an object { available: boolean, note?: string }
    expect(typeof structured.tsgo.available).toBe('boolean');
    expect(typeof structured.oxlint.available).toBe('boolean');
    expect(typeof structured.astGrep.available).toBe('boolean');
  }, 30_000);

  test('should include note when tool has fallback info', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'check_tool_availability', {
      root: ctx.tmpRootAbs,
    });

    // Assert — note is optional string
    if (structured.tsgo.note !== undefined) {
      expect(typeof structured.tsgo.note).toBe('string');
      expect(structured.tsgo.note.length).toBeGreaterThan(0);
    }

    if (structured.oxlint.note !== undefined) {
      expect(typeof structured.oxlint.note).toBe('string');
    }

    // astGrep is bundled – always available, no note expected
    expect(structured.astGrep.available).toBe(true);
  }, 30_000);

  test('should work without explicit root', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'check_tool_availability', {});

    // Assert
    expect(typeof structured.tsgo.available).toBe('boolean');
    expect(typeof structured.oxlint.available).toBe('boolean');
    expect(typeof structured.astGrep.available).toBe('boolean');
  }, 30_000);

  test('should be idempotent (3 rapid calls)', async () => {
    // Act & Assert
    for (let i = 0; i < 3; i++) {
      const { structured } = await callTool(ctx.client, 'check_tool_availability', {
        root: ctx.tmpRootAbs,
      });

      expect(typeof structured.tsgo.available).toBe('boolean');
      expect(typeof structured.oxlint.available).toBe('boolean');
      expect(typeof structured.astGrep.available).toBe('boolean');
    }
  }, 60_000);

  test('should return consistent results across calls', async () => {
    // Act
    const { structured: first } = await callTool(ctx.client, 'check_tool_availability', {
      root: ctx.tmpRootAbs,
    });
    const { structured: second } = await callTool(ctx.client, 'check_tool_availability', {
      root: ctx.tmpRootAbs,
    });

    // Assert — deep equality for objects
    expect(first.tsgo.available).toBe(second.tsgo.available);
    expect(first.oxlint.available).toBe(second.oxlint.available);
    expect(first.astGrep.available).toBe(second.astGrep.available);
  }, 30_000);
});
