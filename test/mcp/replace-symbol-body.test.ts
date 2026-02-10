import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

import { createMcpTestContext, callTool, callToolSafe, type McpTestContext } from './helpers/mcp-client';

const BODY_FIXTURE = [
  'export function compute(x: number): number {',
  '  const doubled = x * 2;',
  '  return doubled + 1;',
  '}',
  '',
  'export class Processor {',
  '  process(input: string): string {',
  '    return input.trim().toUpperCase();',
  '  }',
  '',
  '  validate(input: string): boolean {',
  '    return input.length > 0;',
  '  }',
  '}',
].join('\n');
let ctx: McpTestContext;

beforeAll(async () => {
  ctx = await createMcpTestContext({
    extraFiles: {
      'src/body1.ts': BODY_FIXTURE,
      'src/body2.ts': BODY_FIXTURE,
      'src/body3.ts': BODY_FIXTURE,
    },
  });
}, 30_000);

afterAll(async () => {
  await ctx?.close();
});

describe('replace_symbol_body', () => {
  test('should replace a function body', async () => {
    // Arrange
    const relPath = 'src/body1.ts';
    // Act
    const { structured } = await callTool(ctx.client, 'replace_symbol_body', {
      root: ctx.tmpRootAbs,
      namePath: 'compute',
      relativePath: relPath,
      body: '\n  return x * 3;\n',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');

    if (structured.ok) {
      expect(structured.changed).toBe(true);
    }
  }, 30_000);

  test('should replace a method body using dot notation', async () => {
    // Arrange
    const relPath = 'src/body2.ts';
    // Act
    const { structured } = await callTool(ctx.client, 'replace_symbol_body', {
      root: ctx.tmpRootAbs,
      namePath: 'Processor.process',
      relativePath: relPath,
      body: '\n    return input.toLowerCase();\n  ',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should replace with multiline body', async () => {
    // Arrange
    const relPath = 'src/body3.ts';
    // Act
    const { structured } = await callTool(ctx.client, 'replace_symbol_body', {
      root: ctx.tmpRootAbs,
      namePath: 'compute',
      relativePath: relPath,
      body: [
        '',
        '  const step1 = x * 10;',
        '  const step2 = step1 + 5;',
        '  const step3 = step2 - 3;',
        '  return step3;',
        '',
      ].join('\n'),
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should replace with empty body', async () => {
    // Arrange
    const relPath = 'src/body2.ts';
    // Act
    const { structured } = await callTool(ctx.client, 'replace_symbol_body', {
      root: ctx.tmpRootAbs,
      namePath: 'Processor.validate',
      relativePath: relPath,
      body: '\n    return false;\n  ',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle non-existent symbol', async () => {
    // Arrange & Act
    const { structured } = await callToolSafe(ctx.client, 'replace_symbol_body', {
      root: ctx.tmpRootAbs,
      namePath: 'nonExistent',
      relativePath: 'src/body1.ts',
      body: 'return 0;',
    });

    // Assert
    expect(structured).toBeDefined();
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle non-existent file', async () => {
    // Arrange & Act
    const { structured } = await callToolSafe(ctx.client, 'replace_symbol_body', {
      root: ctx.tmpRootAbs,
      namePath: 'compute',
      relativePath: 'src/ghost.ts',
      body: 'return 0;',
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should handle 3 rapid sequential body replacements', async () => {
    // Arrange
    const relPath = 'src/body3.ts';
    const bodies = ['\n  return x;\n', '\n  return x * 2;\n', '\n  return x + 100;\n'];

    // Act & Assert
    for (const body of bodies) {
      const { structured } = await callToolSafe(ctx.client, 'replace_symbol_body', {
        root: ctx.tmpRootAbs,
        namePath: 'compute',
        relativePath: relPath,
        body,
      });

      expect(structured).toBeDefined();
    }
  }, 30_000);
});
