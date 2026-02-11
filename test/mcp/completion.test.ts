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

describe('get_completion', () => {
  test('should return completions at a position inside a function body', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'get_completion', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 15, // inside createUser body
      character: 4,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
    expect(structured.ok).toBe(true);
    expect(structured.completion).toBeDefined();
  }, 30_000);

  test('should return completions at the beginning of a file', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'get_completion', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 1,
      character: 0,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should accept line as string', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'get_completion', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: '15',
    });

    // Assert
    expect(structured).toBeDefined();
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle non-existent file', async () => {
    // Arrange & Act
    const { structured } = await callToolSafe(ctx.client, 'get_completion', {
      root: ctx.tmpRootAbs,
      filePath: path.join(ctx.tmpRootAbs, 'nope.ts'),
      line: 1,
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should handle out-of-range position', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'get_completion', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 99999,
      character: 0,
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should handle tsconfigPath', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'get_completion', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 15,
      tsconfigPath: path.join(ctx.tmpRootAbs, 'tsconfig.json'),
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should handle 5 rapid sequential completion calls', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    const positions = [
      { line: 3, character: 2 },
      { line: 15, character: 4 },
      { line: 25, character: 8 },
      { line: 35, character: 4 },
      { line: 45, character: 4 },
    ];

    // Act & Assert
    for (const pos of positions) {
      const { structured } = await callToolSafe(ctx.client, 'get_completion', {
        root: ctx.tmpRootAbs,
        filePath: fixture,
        ...pos,
      });

      expect(structured).toBeDefined();
      expect(typeof structured.ok).toBe('boolean');
    }
  }, 60_000);
});
