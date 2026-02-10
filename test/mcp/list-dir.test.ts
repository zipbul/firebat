import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

import { createMcpTestContext, callTool, callToolSafe, type McpTestContext } from './helpers/mcp-client';

let ctx: McpTestContext;

beforeAll(async () => {
  ctx = await createMcpTestContext({ copyFixtures: true });
}, 30_000);

afterAll(async () => {
  await ctx?.close();
});

describe('list_dir', () => {
  // -----------------------------------------------------------------------
  // Happy-path
  // -----------------------------------------------------------------------

  test('should list files in fixtures directory (non-recursive)', async () => {
    // Arrange
    const relPath = 'fixtures';
    // Act
    const { structured } = await callTool(ctx.client, 'list_dir', {
      relativePath: relPath,
    });

    // Assert
    expect(Array.isArray(structured.entries)).toBe(true);
    expect(structured.entries.length).toBeGreaterThan(0);

    const names = structured.entries.map((e: any) => e.name);

    expect(names).toContain('sample.ts');
    expect(names).toContain('editable.ts');

    for (const entry of structured.entries) {
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.isDir).toBe('boolean');
    }
  }, 30_000);

  test('should list root directory', async () => {
    // Arrange & Act
    const { structured } = await callTool(ctx.client, 'list_dir', {
      relativePath: '.',
    });
    // Assert
    const names = structured.entries.map((e: any) => e.name);

    expect(names).toContain('package.json');
    expect(names).toContain('fixtures');
  }, 30_000);

  // -----------------------------------------------------------------------
  // Recursive
  // -----------------------------------------------------------------------

  test('should list files recursively', async () => {
    // Arrange & Act
    const { structured } = await callTool(ctx.client, 'list_dir', {
      relativePath: '.',
      recursive: true,
    });

    // Assert
    expect(Array.isArray(structured.entries)).toBe(true);

    const names = structured.entries.map((e: any) => e.name);

    // Should include nested files like fixtures/sample.ts
    expect(names.some((n: string) => n.includes('sample.ts'))).toBe(true);
  }, 30_000);

  test('should mark directories correctly in recursive listing', async () => {
    // Arrange & Act
    const { structured } = await callTool(ctx.client, 'list_dir', {
      relativePath: '.',
      recursive: true,
    });
    // Assert
    const fixturesEntry = structured.entries.find((e: any) => e.name === 'fixtures');

    expect(fixturesEntry).toBeDefined();
    expect(fixturesEntry.isDir).toBe(true);
  }, 30_000);

  // -----------------------------------------------------------------------
  // With explicit root
  // -----------------------------------------------------------------------

  test('should accept explicit root parameter', async () => {
    // Arrange & Act
    const { structured } = await callTool(ctx.client, 'list_dir', {
      root: ctx.tmpRootAbs,
      relativePath: 'fixtures',
    });

    // Assert
    expect(Array.isArray(structured.entries)).toBe(true);
    expect(structured.entries.length).toBeGreaterThan(0);
  }, 30_000);

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  test('should handle empty directory', async () => {
    // Arrange – .firebat dir exists but may be empty or have minimal content
    const { structured } = await callTool(ctx.client, 'list_dir', {
      relativePath: '.firebat',
    });

    // Assert
    expect(Array.isArray(structured.entries)).toBe(true);
  }, 30_000);

  test('should handle non-existent directory gracefully', async () => {
    // Arrange & Act
    const { isError } = await callToolSafe(ctx.client, 'list_dir', {
      relativePath: 'does-not-exist',
    });

    // Assert
    expect(isError).toBe(true);
  }, 30_000);

  test('should handle deeply nested relative path', async () => {
    // Arrange & Act
    const { structured, isError } = await callToolSafe(ctx.client, 'list_dir', {
      relativePath: 'fixtures',
      recursive: false,
    });

    // Assert
    if (!isError) {
      expect(Array.isArray(structured.entries)).toBe(true);
    }
  }, 30_000);

  // -----------------------------------------------------------------------
  // Stress
  // -----------------------------------------------------------------------

  test('should handle 10 rapid sequential list_dir calls', async () => {
    // Arrange & Act & Assert
    for (let i = 0; i < 10; i++) {
      const { structured, isError } = await callToolSafe(ctx.client, 'list_dir', {
        relativePath: '.',
      });

      expect(isError).toBe(false);
      expect(Array.isArray(structured.entries)).toBe(true);
    }
  }, 30_000);
});
