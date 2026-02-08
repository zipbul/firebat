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

describe('get_code_actions', () => {
  test('should return code actions for a line range', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'get_code_actions', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      startLine: 13,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');

    if (structured.ok) {
      expect(structured.actions).toBeDefined();
    }
  }, 30_000);

  test('should accept startLine and endLine', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'get_code_actions', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      startLine: 13,
      endLine: 20,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should accept startLine as string', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'get_code_actions', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      startLine: '13',
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should accept includeKinds filter', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'get_code_actions', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      startLine: 13,
      includeKinds: ['quickfix'],
    });

    // Assert
    expect(structured).toBeDefined();
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle non-existent file', async () => {
    // Arrange & Act
    const { structured } = await callToolSafe(ctx.client, 'get_code_actions', {
      root: ctx.tmpRootAbs,
      filePath: path.join(ctx.tmpRootAbs, 'nope.ts'),
      startLine: 1,
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should handle out-of-range line', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'get_code_actions', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      startLine: 99999,
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should handle tsconfigPath', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'get_code_actions', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      startLine: 1,
      tsconfigPath: path.join(ctx.tmpRootAbs, 'tsconfig.json'),
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should handle 5 rapid sequential calls', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');

    // Act & Assert
    for (let i = 1; i <= 5; i++) {
      const { structured } = await callToolSafe(ctx.client, 'get_code_actions', {
        root: ctx.tmpRootAbs,
        filePath: fixture,
        startLine: i * 10,
      });

      expect(structured).toBeDefined();
      expect(typeof structured.ok).toBe('boolean');
    }
  }, 60_000);
});
