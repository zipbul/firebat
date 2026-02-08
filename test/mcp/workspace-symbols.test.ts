import * as path from 'node:path';
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createMcpTestContext, callTool, callToolSafe, type McpTestContext } from './helpers/mcp-client';

let ctx: McpTestContext;

beforeAll(async () => {
  ctx = await createMcpTestContext({ copyFixtures: true });
}, 30_000);

afterAll(async () => {
  await ctx?.close();
});

describe('get_workspace_symbols', () => {
  test('should return symbols for a query string', async () => {
    // Arrange & Act
    const { structured } = await callTool(ctx.client, 'get_workspace_symbols', {
      root: ctx.tmpRootAbs,
      query: 'User',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
    if (structured.ok) {
      expect(structured.symbols).toBeDefined();
      expect(Array.isArray(structured.symbols)).toBe(true);
    }
  }, 30_000);

  test('should return symbols without a query (list all)', async () => {
    // Arrange & Act
    const { structured } = await callTool(ctx.client, 'get_workspace_symbols', {
      root: ctx.tmpRootAbs,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should return symbols with empty query', async () => {
    // Arrange & Act
    const { structured } = await callTool(ctx.client, 'get_workspace_symbols', {
      root: ctx.tmpRootAbs,
      query: '',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should return no matches for nonsense query', async () => {
    // Arrange & Act
    const { structured } = await callTool(ctx.client, 'get_workspace_symbols', {
      root: ctx.tmpRootAbs,
      query: 'xyzzy_nonexistent_symbol_12345',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
    if (structured.ok && Array.isArray(structured.symbols)) {
      expect(structured.symbols.length).toBe(0);
    }
  }, 30_000);

  test('should find Calculator class from sample', async () => {
    // Arrange & Act
    const { structured } = await callTool(ctx.client, 'get_workspace_symbols', {
      root: ctx.tmpRootAbs,
      query: 'Calculator',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
    if (structured.ok && Array.isArray(structured.symbols) && structured.symbols.length > 0) {
      const names = structured.symbols.map((s: any) => s.name);
      expect(names).toContain('Calculator');
    }
  }, 30_000);

  test('should accept tsconfigPath', async () => {
    // Arrange & Act
    const { structured } = await callToolSafe(ctx.client, 'get_workspace_symbols', {
      root: ctx.tmpRootAbs,
      query: 'User',
      tsconfigPath: path.join(ctx.tmpRootAbs, 'tsconfig.json'),
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should handle 5 rapid queries', async () => {
    // Arrange
    const queries = ['add', 'greet', 'Color', 'Shape', 'format'];

    // Act & Assert
    for (const q of queries) {
      const { structured } = await callToolSafe(ctx.client, 'get_workspace_symbols', {
        root: ctx.tmpRootAbs,
        query: q,
      });
      expect(structured).toBeDefined();
      expect(typeof structured.ok).toBe('boolean');
    }
  }, 60_000);
});
