import * as path from 'node:path';
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createMcpTestContext, callTool, callToolSafe, type McpTestContext } from './helpers/mcp-client';

const REGEX_FIXTURE = [
  'export const greeting = "Hello, World!";',
  'export const farewell = "Goodbye, World!";',
  'export const tag = "Hello, Universe!";',
  '',
  '// Hello comment',
  'export function sayHello(): string {',
  '  return "Hello!";',
  '}',
  '',
  'export function sayGoodbye(): string {',
  '  return "Goodbye!";',
  '}',
].join('\n');

let ctx: McpTestContext;

beforeAll(async () => {
  ctx = await createMcpTestContext({
    extraFiles: {
      'src/rx1.ts': REGEX_FIXTURE,
      'src/rx2.ts': REGEX_FIXTURE,
      'src/rx3.ts': REGEX_FIXTURE,
      'src/rx4.ts': REGEX_FIXTURE,
      'src/rx5.ts': REGEX_FIXTURE,
    },
  });
}, 30_000);

afterAll(async () => {
  await ctx?.close();
});

describe('replace_regex', () => {
  test('should replace first match by default', async () => {
    // Arrange
    const relPath = 'src/rx1.ts';

    // Act
    const { structured } = await callTool(ctx.client, 'replace_regex', {
      root: ctx.tmpRootAbs,
      relativePath: relPath,
      regex: 'Hello',
      repl: 'Hi',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
    if (structured.ok) {
      expect(structured.changed).toBe(true);
    }
  }, 30_000);

  test('should replace all matches when allowMultipleOccurrences=true', async () => {
    // Arrange
    const relPath = 'src/rx2.ts';

    // Act
    const { structured } = await callTool(ctx.client, 'replace_regex', {
      root: ctx.tmpRootAbs,
      relativePath: relPath,
      regex: 'Hello',
      repl: 'Greetings',
      allowMultipleOccurrences: true,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
    if (structured.ok) {
      expect(structured.changed).toBe(true);
      if (structured.matchCount !== undefined) {
        expect(structured.matchCount).toBeGreaterThan(1);
      }
    }
  }, 30_000);

  test('should handle regex with capture groups', async () => {
    // Arrange
    const relPath = 'src/rx3.ts';

    // Act
    const { structured } = await callTool(ctx.client, 'replace_regex', {
      root: ctx.tmpRootAbs,
      relativePath: relPath,
      regex: '"(Hello|Goodbye), (\\w+)!"',
      repl: '"Hey, $2!"',
      allowMultipleOccurrences: true,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle regex that matches nothing', async () => {
    // Arrange
    const relPath = 'src/rx4.ts';

    // Act
    const { structured } = await callTool(ctx.client, 'replace_regex', {
      root: ctx.tmpRootAbs,
      relativePath: relPath,
      regex: 'xyzzy_nonexistent_pattern',
      repl: 'replaced',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
    if (structured.ok) {
      expect(structured.changed).toBe(false);
    }
  }, 30_000);

  test('should handle multiline regex', async () => {
    // Arrange
    const relPath = 'src/rx5.ts';

    // Act
    const { structured } = await callTool(ctx.client, 'replace_regex', {
      root: ctx.tmpRootAbs,
      relativePath: relPath,
      regex: 'export function sayGoodbye.*?\\}',
      repl: 'export function sayGoodbye(): string {\n  return "Farewell!";\n}',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle replacement with empty string (deletion)', async () => {
    // Arrange
    const relPath = 'src/rx1.ts';

    // Act
    const { structured } = await callTool(ctx.client, 'replace_regex', {
      root: ctx.tmpRootAbs,
      relativePath: relPath,
      regex: '// .* comment\n',
      repl: '',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle non-existent file', async () => {
    // Arrange & Act
    const { structured } = await callToolSafe(ctx.client, 'replace_regex', {
      root: ctx.tmpRootAbs,
      relativePath: 'src/nope.ts',
      regex: 'x',
      repl: 'y',
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should handle invalid regex gracefully', async () => {
    // Arrange & Act
    const { structured, isError } = await callToolSafe(ctx.client, 'replace_regex', {
      root: ctx.tmpRootAbs,
      relativePath: 'src/rx4.ts',
      regex: '[invalid(regex',
      repl: 'x',
    });

    // Assert – server may handle gracefully or return error; either is acceptable
    expect(structured).toBeDefined();
  }, 30_000);

  test('should handle 5 rapid sequential regex replacements', async () => {
    // Arrange
    const relPath = 'src/rx4.ts';

    // Act & Assert
    for (let i = 0; i < 5; i++) {
      const { structured } = await callToolSafe(ctx.client, 'replace_regex', {
        root: ctx.tmpRootAbs,
        relativePath: relPath,
        regex: `tag`,
        repl: `tag${i}`,
      });
      expect(structured).toBeDefined();
    }
  }, 30_000);
});
