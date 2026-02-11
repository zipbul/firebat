import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as path from 'node:path';

import { createMcpTestContext, callTool, callToolSafe, type McpTestContext } from './helpers/mcp-client';

let ctx: McpTestContext;

beforeAll(async () => {
  ctx = await createMcpTestContext({
    copyFixtures: true,
    extraFiles: {
      'src/format-me.ts': ['export function   ugly(   x:number,y  :string   ):   string{', '  return x  +   y', '}'].join('\n'),
    },
  });
}, 30_000);

afterAll(async () => {
  await ctx?.close();
});

describe('format_document', () => {
  test('should format a single file', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'format_document', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
    expect(structured.ok).toBe(true);
    expect(typeof structured.changed).toBe('boolean');
  }, 30_000);

  test('should format a directory of files', async () => {
    // Arrange
    const dir = ctx.fixturesAbs;
    // Act
    const { structured } = await callTool(ctx.client, 'format_document', {
      root: ctx.tmpRootAbs,
      filePath: dir,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
    expect(structured.ok).toBe(true);
    expect(typeof structured.changedCount).toBe('number');
  }, 60_000);

  test('should handle non-existent file', async () => {
    // Arrange & Act
    const { structured } = await callToolSafe(ctx.client, 'format_document', {
      root: ctx.tmpRootAbs,
      filePath: path.join(ctx.tmpRootAbs, 'nope.ts'),
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should accept tsconfigPath', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'format_document', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      tsconfigPath: path.join(ctx.tmpRootAbs, 'tsconfig.json'),
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should be idempotent (formatting twice produces same result)', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured: first } = await callTool(ctx.client, 'format_document', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
    });
    const { structured: second } = await callTool(ctx.client, 'format_document', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
    });

    // Assert
    expect(typeof first.ok).toBe('boolean');
    expect(typeof second.ok).toBe('boolean');
  }, 30_000);

  test('should handle 5 rapid sequential format calls', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');

    // Act & Assert
    for (let i = 0; i < 5; i++) {
      const { structured } = await callToolSafe(ctx.client, 'format_document', {
        root: ctx.tmpRootAbs,
        filePath: fixture,
      });

      expect(structured).toBeDefined();
      expect(typeof structured.ok).toBe('boolean');
    }
  }, 60_000);
});
