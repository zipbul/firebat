import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as path from 'node:path';

import { createMcpTestContext, callTool, callToolSafe, type McpTestContext } from './helpers/mcp-client';

const DELETE_FIXTURE = [
  'export function toDelete(x: number): number {',
  '  return x;',
  '}',
  '',
  'export function toKeep(y: string): string {',
  '  return y;',
  '}',
  '',
  'export class DeleteMe {',
  '  val = 1;',
  '}',
].join('\n');
let ctx: McpTestContext;

beforeAll(async () => {
  ctx = await createMcpTestContext({
    extraFiles: {
      'src/del1.ts': DELETE_FIXTURE,
      'src/del2.ts': DELETE_FIXTURE,
      'src/del3.ts': DELETE_FIXTURE,
    },
  });
}, 30_000);

afterAll(async () => {
  await ctx?.close();
});

describe('delete_symbol', () => {
  test('should delete a function from the file', async () => {
    // Arrange
    const filePath = path.join(ctx.tmpRootAbs, 'src/del1.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'delete_symbol', {
      root: ctx.tmpRootAbs,
      filePath,
      line: 1,
      symbolName: 'toDelete',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');

    if (structured.ok) {
      expect(structured.changed).toBe(true);
    }
  }, 30_000);

  test('should delete a class from the file', async () => {
    // Arrange
    const filePath = path.join(ctx.tmpRootAbs, 'src/del2.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'delete_symbol', {
      root: ctx.tmpRootAbs,
      filePath,
      line: 9,
      symbolName: 'DeleteMe',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle non-existent symbol', async () => {
    // Arrange
    const filePath = path.join(ctx.tmpRootAbs, 'src/del3.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'delete_symbol', {
      root: ctx.tmpRootAbs,
      filePath,
      line: 1,
      symbolName: 'doesNotExist',
    });

    // Assert
    expect(structured).toBeDefined();
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle non-existent file', async () => {
    // Arrange & Act
    const { structured } = await callToolSafe(ctx.client, 'delete_symbol', {
      root: ctx.tmpRootAbs,
      filePath: path.join(ctx.tmpRootAbs, 'nope.ts'),
      line: 1,
      symbolName: 'x',
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should accept line as string', async () => {
    // Arrange
    const filePath = path.join(ctx.tmpRootAbs, 'src/del3.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'delete_symbol', {
      root: ctx.tmpRootAbs,
      filePath,
      line: '5',
      symbolName: 'toKeep',
    });

    // Assert
    expect(structured).toBeDefined();
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle tsconfigPath', async () => {
    // Arrange
    const filePath = path.join(ctx.tmpRootAbs, 'src/del3.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'delete_symbol', {
      root: ctx.tmpRootAbs,
      filePath,
      line: 1,
      symbolName: 'toDelete',
      tsconfigPath: path.join(ctx.tmpRootAbs, 'tsconfig.json'),
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);
});
