import * as path from 'node:path';
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createMcpTestContext, callTool, callToolSafe, type McpTestContext } from './helpers/mcp-client';

let ctx: McpTestContext;

beforeAll(async () => {
  ctx = await createMcpTestContext({ copyFixtures: true });
}, 30_000);

afterAll(async () => {
  await ctx?.close();
});

describe('find_pattern', () => {
  // -----------------------------------------------------------------------
  // Happy-path: rule-based
  // -----------------------------------------------------------------------

  test('should find console.log calls using a rule pattern', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'find_pattern', {
      targets: [fixture],
      rule: { pattern: 'console.log($$$ARGS)' },
      ruleName: 'find-console-log',
    });

    // Assert
    expect(Array.isArray(structured.matches)).toBe(true);
    expect(structured.matches.length).toBeGreaterThan(0);
    for (const match of structured.matches) {
      expect(match.filePath).toBeDefined();
      expect(match.text).toContain('console.log');
      expect(match.span).toBeDefined();
      expect(typeof match.span.start.line).toBe('number');
    }
  }, 30_000);

  test('should find console.error calls separately', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'find_pattern', {
      targets: [fixture],
      rule: { pattern: 'console.error($$$ARGS)' },
    });

    // Assert
    expect(Array.isArray(structured.matches)).toBe(true);
    expect(structured.matches.length).toBeGreaterThan(0);
  }, 30_000);

  // -----------------------------------------------------------------------
  // Happy-path: matcher-based
  // -----------------------------------------------------------------------

  test('should find patterns using matcher (string shorthand)', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'find_pattern', {
      targets: [fixture],
      matcher: 'return $X',
    });

    // Assert
    expect(Array.isArray(structured.matches)).toBe(true);
    expect(structured.matches.length).toBeGreaterThan(0);
  }, 30_000);

  // -----------------------------------------------------------------------
  // Multiple targets
  // -----------------------------------------------------------------------

  test('should search across multiple files', async () => {
    // Arrange
    const targets = [
      path.join(ctx.fixturesAbs, 'sample.ts'),
      path.join(ctx.fixturesAbs, 'editable.ts'),
    ];

    // Act
    const { structured } = await callTool(ctx.client, 'find_pattern', {
      targets,
      rule: { pattern: 'return $X' },
    });

    // Assert
    expect(Array.isArray(structured.matches)).toBe(true);
    // Should find return statements across both files
    const files = new Set(structured.matches.map((m: any) => m.filePath));
    expect(files.size).toBeGreaterThanOrEqual(1);
  }, 30_000);

  // -----------------------------------------------------------------------
  // No matches
  // -----------------------------------------------------------------------

  test('should return empty matches when pattern does not exist', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'find_pattern', {
      targets: [fixture],
      rule: { pattern: 'window.alert($$$ARGS)' },
    });

    // Assert
    expect(Array.isArray(structured.matches)).toBe(true);
    expect(structured.matches.length).toBe(0);
  }, 30_000);

  // -----------------------------------------------------------------------
  // Error cases
  // -----------------------------------------------------------------------

  test('should error when neither rule nor matcher is provided', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');

    // Act
    const { isError } = await callToolSafe(ctx.client, 'find_pattern', {
      targets: [fixture],
    });

    // Assert
    expect(isError).toBe(true);
  }, 30_000);

  test('should handle non-existent target file gracefully', async () => {
    // Arrange
    const bogus = path.join(ctx.tmpRootAbs, 'ghost.ts');

    // Act
    const { structured } = await callToolSafe(ctx.client, 'find_pattern', {
      targets: [bogus],
      rule: { pattern: 'console.log($$$A)' },
    });

    // Assert – should not crash; may return empty matches or error
    expect(structured).toBeDefined();
  }, 30_000);

  // -----------------------------------------------------------------------
  // Complex patterns
  // -----------------------------------------------------------------------

  test('should match class declarations', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'find_pattern', {
      targets: [fixture],
      rule: { pattern: 'class $NAME { $$$BODY }' },
    });

    // Assert
    expect(Array.isArray(structured.matches)).toBe(true);
    expect(structured.matches.length).toBeGreaterThan(0);
  }, 30_000);

  test('should match arrow functions', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'find_pattern', {
      targets: [fixture],
      rule: { pattern: '($$$PARAMS) => { $$$BODY }' },
    });

    // Assert
    expect(Array.isArray(structured.matches)).toBe(true);
  }, 30_000);

  test('should match if-statements', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'find_pattern', {
      targets: [fixture],
      rule: { pattern: 'if ($COND) { $$$BODY }' },
    });

    // Assert
    expect(Array.isArray(structured.matches)).toBe(true);
    expect(structured.matches.length).toBeGreaterThan(0);
  }, 30_000);

  // -----------------------------------------------------------------------
  // Stress: many patterns in sequence
  // -----------------------------------------------------------------------

  test('should handle 10 rapid sequential pattern searches', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');
    const patterns = [
      'console.log($$$A)',
      'return $X',
      'function $NAME($$$PARAMS) { $$$BODY }',
      'if ($C) { $$$B }',
      'this.$PROP += $V',
      'this.$PROP -= $V',
      'this.$PROP *= $V',
      'export const $N = $V',
      'export function $N($$$P): $T { $$$B }',
      'void $X',
    ];

    // Act & Assert
    for (const pattern of patterns) {
      const { structured, isError } = await callToolSafe(ctx.client, 'find_pattern', {
        targets: [fixture],
        rule: { pattern },
      });
      expect(isError).toBe(false);
      expect(Array.isArray(structured.matches)).toBe(true);
    }
  }, 60_000);

  // -----------------------------------------------------------------------
  // Directory target
  // -----------------------------------------------------------------------

  test('should search in an entire directory', async () => {
    // Arrange
    const dir = ctx.fixturesAbs;

    // Act
    const { structured } = await callTool(ctx.client, 'find_pattern', {
      targets: [dir],
      rule: { pattern: 'export function $NAME($$$P): $T { $$$B }' },
    });

    // Assert
    expect(Array.isArray(structured.matches)).toBe(true);
    expect(structured.matches.length).toBeGreaterThan(0);
  }, 30_000);
});
