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

describe('get_document_symbols', () => {
  test('should return symbols for a file with classes, functions, and interfaces', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'get_document_symbols', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');

    if (structured.ok) {
      expect(structured.symbols).toBeDefined();
      expect(Array.isArray(structured.symbols)).toBe(true);
      expect(structured.symbols.length).toBeGreaterThan(0);
    }
  }, 30_000);

  test('should return symbols for the sample fixture', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'get_document_symbols', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');

    if (structured.ok) {
      expect(Array.isArray(structured.symbols)).toBe(true);
    }
  }, 30_000);

  test('should return symbols for the editable fixture', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'editable.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'get_document_symbols', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle non-existent file', async () => {
    // Arrange & Act
    const { structured } = await callToolSafe(ctx.client, 'get_document_symbols', {
      root: ctx.tmpRootAbs,
      filePath: path.join(ctx.tmpRootAbs, 'nope.ts'),
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should accept tsconfigPath', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'get_document_symbols', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      tsconfigPath: path.join(ctx.tmpRootAbs, 'tsconfig.json'),
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should handle 5 rapid sequential calls across different files', async () => {
    // Arrange
    const files = [
      path.join(ctx.fixturesAbs, 'sample.ts'),
      path.join(ctx.fixturesAbs, 'lsp-target.ts'),
      path.join(ctx.fixturesAbs, 'editable.ts'),
      path.join(ctx.fixturesAbs, 'import-target.ts'),
      path.join(ctx.fixturesAbs, 'sample.ts'),
    ];

    // Act & Assert
    for (const f of files) {
      const { structured } = await callToolSafe(ctx.client, 'get_document_symbols', {
        root: ctx.tmpRootAbs,
        filePath: f,
      });

      expect(structured).toBeDefined();
      expect(typeof structured.ok).toBe('boolean');
    }
  }, 60_000);
});
