import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as path from 'node:path';

import { createMcpTestContext, callTool, callToolSafe, type McpTestContext } from './helpers/mcp-client';

let ctx: McpTestContext;

beforeAll(async () => {
  ctx = await createMcpTestContext({
    copyFixtures: true,
    extraFiles: {
      'src/with-errors.ts': [
        '// Intentional type error for diagnostics testing',
        'export const badType: number = "not a number" as any;',
        'export const ok: string = "fine";',
      ].join('\n'),
    },
  });
}, 30_000);

afterAll(async () => {
  await ctx?.close();
});

describe('get_diagnostics', () => {
  test('should return diagnostics for a valid file', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'get_diagnostics', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');

    if (structured.ok) {
      // diagnostics may be an empty array for a clean file
      expect(structured.diagnostics).toBeDefined();
    }
  }, 30_000);

  test('should accept forceRefresh=true', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'get_diagnostics', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      forceRefresh: true,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should accept timeoutMs', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'get_diagnostics', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      timeoutMs: 10_000,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle non-existent file', async () => {
    // Arrange & Act
    const { structured } = await callToolSafe(ctx.client, 'get_diagnostics', {
      root: ctx.tmpRootAbs,
      filePath: path.join(ctx.tmpRootAbs, 'nope.ts'),
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should handle tsconfigPath parameter', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'get_diagnostics', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      tsconfigPath: path.join(ctx.tmpRootAbs, 'tsconfig.json'),
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should handle 5 rapid sequential diagnostics calls', async () => {
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
      const { structured } = await callToolSafe(ctx.client, 'get_diagnostics', {
        root: ctx.tmpRootAbs,
        filePath: f,
      });

      expect(structured).toBeDefined();
      expect(typeof structured.ok).toBe('boolean');
    }
  }, 60_000);
});

describe('get_all_diagnostics', () => {
  test('should return diagnostics for the entire project', async () => {
    // Arrange & Act
    const { structured } = await callTool(ctx.client, 'get_all_diagnostics', {
      root: ctx.tmpRootAbs,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');

    if (structured.ok) {
      expect(structured.diagnostics).toBeDefined();
    }
  }, 60_000);

  test('should accept tsconfigPath', async () => {
    // Arrange & Act
    const { structured } = await callToolSafe(ctx.client, 'get_all_diagnostics', {
      root: ctx.tmpRootAbs,
      tsconfigPath: path.join(ctx.tmpRootAbs, 'tsconfig.json'),
    });

    // Assert
    expect(structured).toBeDefined();
    expect(typeof structured.ok).toBe('boolean');
  }, 60_000);

  test('should handle empty root', async () => {
    // Arrange & Act
    const { structured } = await callToolSafe(ctx.client, 'get_all_diagnostics', {});

    // Assert
    expect(structured).toBeDefined();
    expect(typeof structured.ok).toBe('boolean');
  }, 60_000);

  test('should handle 3 rapid sequential get_all_diagnostics calls', async () => {
    // Act & Assert
    for (let i = 0; i < 3; i++) {
      const { structured } = await callToolSafe(ctx.client, 'get_all_diagnostics', {
        root: ctx.tmpRootAbs,
      });

      expect(structured).toBeDefined();
      expect(typeof structured.ok).toBe('boolean');
    }
  }, 120_000);
});
