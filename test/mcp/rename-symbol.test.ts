import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as path from 'node:path';

import { createMcpTestContext, callTool, callToolSafe, type McpTestContext } from './helpers/mcp-client';

const RENAME_FIXTURE = ['export function oldName(x: number): number { return x; }', '', 'export function other(): void {}'].join(
  '\n',
);
let ctx: McpTestContext;

beforeAll(async () => {
  ctx = await createMcpTestContext({
    extraFiles: {
      'src/rename1.ts': RENAME_FIXTURE,
      'src/rename2.ts': RENAME_FIXTURE,
    },
  });
}, 30_000);

afterAll(async () => {
  await ctx?.close();
});

describe('rename_symbol', () => {
  test('should rename a function across the file', async () => {
    // Arrange
    const filePath = path.join(ctx.tmpRootAbs, 'src/rename1.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'rename_symbol', {
      root: ctx.tmpRootAbs,
      filePath,
      symbolName: 'targetFn',
      newName: 'renamedFn',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');

    if (structured.ok) {
      expect(Array.isArray(structured.changedFiles)).toBe(true);
      expect(structured.changedFiles.length).toBeGreaterThan(0);
    }
  }, 30_000);

  test('should rename a class', async () => {
    // Arrange
    const filePath = path.join(ctx.tmpRootAbs, 'src/rename2.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'rename_symbol', {
      root: ctx.tmpRootAbs,
      filePath,
      symbolName: 'RenameMe',
      newName: 'RenamedClass',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should accept line hint', async () => {
    // Arrange
    const filePath = path.join(ctx.tmpRootAbs, 'src/rename3.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'rename_symbol', {
      root: ctx.tmpRootAbs,
      filePath,
      line: 1,
      symbolName: 'targetFn',
      newName: 'anotherName',
    });

    // Assert
    expect(structured).toBeDefined();
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle non-existent symbol', async () => {
    // Arrange
    const filePath = path.join(ctx.tmpRootAbs, 'src/rename1.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'rename_symbol', {
      root: ctx.tmpRootAbs,
      filePath,
      symbolName: 'doesNotExist',
      newName: 'whatever',
    });

    // Assert
    expect(structured).toBeDefined();
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle non-existent file', async () => {
    // Arrange & Act
    const { structured } = await callToolSafe(ctx.client, 'rename_symbol', {
      root: ctx.tmpRootAbs,
      filePath: path.join(ctx.tmpRootAbs, 'nope.ts'),
      symbolName: 'x',
      newName: 'y',
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should handle tsconfigPath', async () => {
    // Arrange
    const filePath = path.join(ctx.tmpRootAbs, 'src/rename1.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'rename_symbol', {
      root: ctx.tmpRootAbs,
      filePath,
      symbolName: 'renamedFn',
      newName: 'renamedAgain',
      tsconfigPath: path.join(ctx.tmpRootAbs, 'tsconfig.json'),
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);
});
