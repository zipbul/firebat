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

describe('get_signature_help', () => {
  test('should return signature help inside a function call', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act – line of greetUser which calls getUserName(user)
    const { structured } = await callTool(ctx.client, 'get_signature_help', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 26,
      character: 27, // inside getUserName( ...
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
    expect(structured.ok).toBe(true);
    expect(structured.signatureHelp).toBeDefined();
  }, 30_000);

  test('should accept line as string', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'get_signature_help', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: '26',
      character: 27,
    });

    // Assert
    expect(structured).toBeDefined();
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle position outside a function call', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'get_signature_help', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 1,
      character: 0,
    });

    // Assert
    expect(structured).toBeDefined();
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle non-existent file', async () => {
    // Arrange & Act
    const { structured } = await callToolSafe(ctx.client, 'get_signature_help', {
      root: ctx.tmpRootAbs,
      filePath: path.join(ctx.tmpRootAbs, 'ghost.ts'),
      line: 1,
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should handle out-of-range line', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'get_signature_help', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 99999,
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should handle tsconfigPath', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'get_signature_help', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 26,
      character: 27,
      tsconfigPath: path.join(ctx.tmpRootAbs, 'tsconfig.json'),
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should handle 5 rapid sequential calls', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');

    // Act & Assert
    for (let i = 0; i < 5; i++) {
      const { structured } = await callToolSafe(ctx.client, 'get_signature_help', {
        root: ctx.tmpRootAbs,
        filePath: fixture,
        line: 26,
        character: 27,
      });

      expect(structured).toBeDefined();
      expect(typeof structured.ok).toBe('boolean');
    }
  }, 60_000);
});
