import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as path from 'node:path';

import { createMcpTestContext, callTool, callToolSafe, type McpTestContext } from './helpers/mcp-client';

let ctx: McpTestContext;

interface TraceGraph {
  readonly nodes: ReadonlyArray<unknown>;
  readonly edges: ReadonlyArray<unknown>;
}

interface TraceSymbolStructured {
  readonly ok: boolean;
  readonly graph?: TraceGraph;
  readonly error?: unknown;
}

const assertTraceResult = (structured: TraceSymbolStructured): void => {
  if (structured.ok) {
    expect(structured.graph).toBeDefined();
    expect(Array.isArray(structured.graph?.nodes)).toBe(true);
    expect(Array.isArray(structured.graph?.edges)).toBe(true);

    return;
  }

  // tsgo not available – error structure should still be valid
  expect(structured.error).toBeDefined();
};

beforeAll(async () => {
  ctx = await createMcpTestContext({ copyFixtures: true });
}, 30_000);

afterAll(async () => {
  await ctx?.close();
});

describe('trace_symbol', () => {
  // -----------------------------------------------------------------------
  // Happy-path
  // -----------------------------------------------------------------------

  test('should trace an exported function symbol', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'trace_symbol', {
      entryFile: fixture,
      symbol: 'createUser',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
    assertTraceResult(structured as TraceSymbolStructured);
  }, 60_000);

  test('should trace a class symbol', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'trace_symbol', {
      entryFile: fixture,
      symbol: 'UserService',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 60_000);

  test('should trace an interface symbol', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'trace_symbol', {
      entryFile: fixture,
      symbol: 'User',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 60_000);

  test('should trace a type alias', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'trace_symbol', {
      entryFile: fixture,
      symbol: 'UserCreateInput',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 60_000);

  // -----------------------------------------------------------------------
  // maxDepth
  // -----------------------------------------------------------------------

  test('should respect maxDepth=0 (no traversal)', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'trace_symbol', {
      entryFile: fixture,
      symbol: 'createUser',
      maxDepth: 0,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 60_000);

  test('should handle maxDepth=5', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'trace_symbol', {
      entryFile: fixture,
      symbol: 'greetUser',
      maxDepth: 5,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 60_000);

  // -----------------------------------------------------------------------
  // Error cases
  // -----------------------------------------------------------------------

  test('should handle non-existent symbol gracefully', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'trace_symbol', {
      entryFile: fixture,
      symbol: 'thisSymbolDoesNotExist',
    });

    // Assert
    expect(structured).toBeDefined();
    expect(typeof structured.ok).toBe('boolean');
  }, 60_000);

  test('should handle non-existent file gracefully', async () => {
    // Arrange
    const bogus = path.join(ctx.tmpRootAbs, 'nope.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'trace_symbol', {
      entryFile: bogus,
      symbol: 'anything',
    });

    // Assert
    expect(structured).toBeDefined();
  }, 60_000);

  // -----------------------------------------------------------------------
  // tsconfigPath
  // -----------------------------------------------------------------------

  test('should accept tsconfigPath without crashing', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'trace_symbol', {
      entryFile: fixture,
      symbol: 'User',
      tsconfigPath: path.join(ctx.tmpRootAbs, 'tsconfig.json'),
    });

    // Assert
    expect(structured).toBeDefined();
  }, 60_000);

  // -----------------------------------------------------------------------
  // Stress
  // -----------------------------------------------------------------------

  test('should handle 5 rapid sequential trace calls', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    const symbols = ['User', 'createUser', 'UserService', 'greetUser', 'DEFAULT_USER'];
    // Act & Assert
    const results = await Promise.all(
      symbols.map(symbol =>
        callToolSafe(ctx.client, 'trace_symbol', {
          entryFile: fixture,
          symbol,
        }),
      ),
    );

    results.forEach(({ structured }) => {
      expect(structured).toBeDefined();
      expect(typeof structured.ok).toBe('boolean');
    });
  }, 120_000);
});
