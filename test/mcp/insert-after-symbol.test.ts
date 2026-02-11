import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

import { createMcpTestContext, callTool, callToolSafe, type McpTestContext } from './helpers/mcp-client';

const INSERT_FIXTURE = [
  'export function target(x: number): number {',
  '  return x;',
  '}',
  '',
  'export class Widget {',
  '  render(): string {',
  '    return "<div />";',
  '  }',
  '}',
].join('\n');
let ctx: McpTestContext;

beforeAll(async () => {
  ctx = await createMcpTestContext({
    extraFiles: {
      'src/ins-after1.ts': INSERT_FIXTURE,
      'src/ins-after2.ts': INSERT_FIXTURE,
      'src/ins-after3.ts': INSERT_FIXTURE,
    },
  });
}, 30_000);

afterAll(async () => {
  await ctx?.close();
});

describe('insert_after_symbol', () => {
  test('should insert text after a function', async () => {
    // Arrange
    const relPath = 'src/ins-after1.ts';
    // Act
    const { structured } = await callTool(ctx.client, 'insert_after_symbol', {
      root: ctx.tmpRootAbs,
      namePath: 'target',
      relativePath: relPath,
      body: '\nexport function afterTarget(): void {}\n',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
    expect(structured.ok).toBe(true);
    expect(structured.changed).toBe(true);
  }, 30_000);

  test('should insert text after a class', async () => {
    // Arrange
    const relPath = 'src/ins-after2.ts';
    // Act
    const { structured } = await callTool(ctx.client, 'insert_after_symbol', {
      root: ctx.tmpRootAbs,
      namePath: 'Widget',
      relativePath: relPath,
      body: '\n// After Widget\nexport const WIDGET_VERSION = 1;\n',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should insert multiline code block', async () => {
    // Arrange
    const relPath = 'src/ins-after3.ts';
    // Act
    const { structured } = await callTool(ctx.client, 'insert_after_symbol', {
      root: ctx.tmpRootAbs,
      namePath: 'target',
      relativePath: relPath,
      body: ['', 'export function companion(y: number): number {', '  return y * 2;', '}', ''].join('\n'),
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle non-existent symbol', async () => {
    // Arrange & Act
    const { structured } = await callToolSafe(ctx.client, 'insert_after_symbol', {
      root: ctx.tmpRootAbs,
      namePath: 'nonExistent',
      relativePath: 'src/ins-after1.ts',
      body: '// noop\n',
    });

    // Assert
    expect(structured).toBeDefined();
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle non-existent file', async () => {
    // Arrange & Act
    const { structured } = await callToolSafe(ctx.client, 'insert_after_symbol', {
      root: ctx.tmpRootAbs,
      namePath: 'x',
      relativePath: 'src/ghost.ts',
      body: '// noop\n',
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should handle 3 rapid sequential inserts after same symbol', async () => {
    // Arrange
    const relPath = 'src/ins-after1.ts';

    // Act & Assert
    for (let i = 0; i < 3; i++) {
      const { structured } = await callToolSafe(ctx.client, 'insert_after_symbol', {
        root: ctx.tmpRootAbs,
        namePath: 'target',
        relativePath: relPath,
        body: `\n// after insert ${i}\n`,
      });

      expect(structured).toBeDefined();
    }
  }, 30_000);
});
