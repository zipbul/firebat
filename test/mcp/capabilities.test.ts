import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as path from 'node:path';

import { createMcpTestContext, callTool, callToolSafe, type McpTestContext } from './helpers/mcp-client';

let ctx: McpTestContext;

beforeAll(async () => {
  ctx = await createMcpTestContext({ copyFixtures: true });
}, 30_000);

afterAll(async () => {
  await ctx?.close();
});

describe('check_capabilities', () => {
  test('should return capability information', async () => {
    // Arrange & Act
    const { structured } = await callTool(ctx.client, 'check_capabilities', {
      root: ctx.tmpRootAbs,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
    expect(structured.ok).toBe(true);
    expect(structured.capabilities).toBeDefined();
  }, 30_000);

  test('should accept tsconfigPath', async () => {
    // Arrange & Act
    const { structured } = await callToolSafe(ctx.client, 'check_capabilities', {
      root: ctx.tmpRootAbs,
      tsconfigPath: path.join(ctx.tmpRootAbs, 'tsconfig.json'),
    });

    // Assert
    expect(structured).toBeDefined();
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should work without root (uses default)', async () => {
    // Arrange & Act
    const { structured } = await callToolSafe(ctx.client, 'check_capabilities', {});

    // Assert
    expect(structured).toBeDefined();
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle 3 rapid sequential calls', async () => {
    // Act & Assert
    for (let i = 0; i < 3; i++) {
      const { structured } = await callToolSafe(ctx.client, 'check_capabilities', {
        root: ctx.tmpRootAbs,
      });

      expect(structured).toBeDefined();
      expect(typeof structured.ok).toBe('boolean');
    }
  }, 30_000);
});
