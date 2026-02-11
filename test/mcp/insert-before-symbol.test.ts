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
      'src/ins-before1.ts': INSERT_FIXTURE,
      'src/ins-before2.ts': INSERT_FIXTURE,
      'src/ins-before3.ts': INSERT_FIXTURE,
    },
  });
}, 30_000);

afterAll(async () => {
  await ctx?.close();
});

describe('insert_before_symbol', () => {
  test('should insert text before a function', async () => {
    // Arrange
    const relPath = 'src/ins-before1.ts';
    // Act
    const { structured } = await callTool(ctx.client, 'insert_before_symbol', {
      root: ctx.tmpRootAbs,
      namePath: 'target',
      relativePath: relPath,
      body: '/** This function does something */\n',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
    expect(structured.ok).toBe(true);
    expect(structured.changed).toBe(true);
  }, 30_000);

  test('should insert text before a class', async () => {
    // Arrange
    const relPath = 'src/ins-before2.ts';
    // Act
    const { structured } = await callTool(ctx.client, 'insert_before_symbol', {
      root: ctx.tmpRootAbs,
      namePath: 'Widget',
      relativePath: relPath,
      body: '// Widget class below\n',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should insert multiline text', async () => {
    // Arrange
    const relPath = 'src/ins-before3.ts';
    // Act
    const { structured } = await callTool(ctx.client, 'insert_before_symbol', {
      root: ctx.tmpRootAbs,
      namePath: 'target',
      relativePath: relPath,
      body: ['/**', ' * @param x - the input number', ' * @returns the same number', ' */', ''].join('\n'),
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle non-existent symbol', async () => {
    // Arrange & Act
    const { structured } = await callToolSafe(ctx.client, 'insert_before_symbol', {
      root: ctx.tmpRootAbs,
      namePath: 'nonExistent',
      relativePath: 'src/ins-before1.ts',
      body: '// noop\n',
    });

    // Assert
    expect(structured).toBeDefined();
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle non-existent file', async () => {
    // Arrange & Act
    const { structured } = await callToolSafe(ctx.client, 'insert_before_symbol', {
      root: ctx.tmpRootAbs,
      namePath: 'x',
      relativePath: 'src/ghost.ts',
      body: '// noop\n',
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should handle 3 rapid sequential inserts on same symbol', async () => {
    // Arrange
    const relPath = 'src/ins-before1.ts';

    // Act & Assert
    for (let i = 0; i < 3; i++) {
      const { structured } = await callToolSafe(ctx.client, 'insert_before_symbol', {
        root: ctx.tmpRootAbs,
        namePath: 'target',
        relativePath: relPath,
        body: `// insert ${i}\n`,
      });

      expect(structured).toBeDefined();
    }
  }, 30_000);
});
