import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

import { createMcpTestContext, callTool, callToolSafe, type McpTestContext } from './helpers/mcp-client';

const REPLACE_FIXTURE = [
  'export function greet(name: string): string {',
  '  return `Hello, ${name}!`;',
  '}',
  '',
  'export function farewell(name: string): string {',
  '  return `Goodbye, ${name}!`;',
  '}',
  '',
  'export const TAG = "original";',
].join('\n');
let ctx: McpTestContext;

beforeAll(async () => {
  ctx = await createMcpTestContext({
    extraFiles: {
      'src/rr1.ts': REPLACE_FIXTURE,
      'src/rr2.ts': REPLACE_FIXTURE,
      'src/rr3.ts': REPLACE_FIXTURE,
      'src/rr4.ts': REPLACE_FIXTURE,
      'src/rr5.ts': REPLACE_FIXTURE,
    },
  });
}, 30_000);

afterAll(async () => {
  await ctx?.close();
});

describe('replace_range', () => {
  test('should replace a single line', async () => {
    // Arrange
    const relPath = 'src/rr1.ts';
    // Act
    const { structured } = await callTool(ctx.client, 'replace_range', {
      root: ctx.tmpRootAbs,
      relativePath: relPath,
      startLine: 9,
      startColumn: 1,
      endLine: 9,
      endColumn: 100,
      newText: 'export const TAG = "replaced";',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
    expect(structured.ok).toBe(true);
    expect(structured.changed).toBe(true);
    expect(structured.filePath).toBeDefined();
  }, 30_000);

  test('should replace a multi-line range', async () => {
    // Arrange
    const relPath = 'src/rr2.ts';
    // Act
    const { structured } = await callTool(ctx.client, 'replace_range', {
      root: ctx.tmpRootAbs,
      relativePath: relPath,
      startLine: 1,
      startColumn: 1,
      endLine: 3,
      endColumn: 2,
      newText: 'export function greet(name: string): string {\n  return `Hi, ${name}!`;\n}',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
    expect(structured.ok).toBe(true);
    expect(structured.changed).toBe(true);
  }, 30_000);

  test('should replace with empty text (deletion)', async () => {
    // Arrange
    const relPath = 'src/rr3.ts';
    // Act
    const { structured } = await callTool(ctx.client, 'replace_range', {
      root: ctx.tmpRootAbs,
      relativePath: relPath,
      startLine: 9,
      startColumn: 1,
      endLine: 9,
      endColumn: 100,
      newText: '',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle single-character replacement', async () => {
    // Arrange
    const relPath = 'src/rr4.ts';
    // Act
    const { structured } = await callTool(ctx.client, 'replace_range', {
      root: ctx.tmpRootAbs,
      relativePath: relPath,
      startLine: 2,
      startColumn: 10,
      endLine: 2,
      endColumn: 15,
      newText: 'Hi',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle non-existent file', async () => {
    // Arrange & Act
    const { structured } = await callToolSafe(ctx.client, 'replace_range', {
      root: ctx.tmpRootAbs,
      relativePath: 'src/nope.ts',
      startLine: 1,
      startColumn: 1,
      endLine: 1,
      endColumn: 1,
      newText: 'x',
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should handle out-of-range line numbers', async () => {
    // Arrange & Act
    const { structured } = await callToolSafe(ctx.client, 'replace_range', {
      root: ctx.tmpRootAbs,
      relativePath: 'src/rr5.ts',
      startLine: 9999,
      startColumn: 1,
      endLine: 9999,
      endColumn: 1,
      newText: 'x',
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should handle inserting multiline text', async () => {
    // Arrange
    const relPath = 'src/rr5.ts';
    // Act
    const { structured } = await callTool(ctx.client, 'replace_range', {
      root: ctx.tmpRootAbs,
      relativePath: relPath,
      startLine: 4,
      startColumn: 1,
      endLine: 4,
      endColumn: 1,
      newText: '// inserted line 1\n// inserted line 2\n',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle 5 rapid sequential replacements on same file', async () => {
    // Arrange
    const relPath = 'src/rr1.ts';

    // Act & Assert
    for (let i = 0; i < 5; i++) {
      const { structured } = await callToolSafe(ctx.client, 'replace_range', {
        root: ctx.tmpRootAbs,
        relativePath: relPath,
        startLine: 1,
        startColumn: 1,
        endLine: 1,
        endColumn: 1,
        newText: `// iteration ${i}\n`,
      });

      expect(structured).toBeDefined();
    }
  }, 30_000);
});
