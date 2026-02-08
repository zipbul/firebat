import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as path from 'node:path';

import { createMcpTestContext, callTool, callToolSafe, type McpTestContext } from './helpers/mcp-client';

let ctx: McpTestContext;

beforeAll(async () => {
  ctx = await createMcpTestContext({ copyFixtures: true });
}, 30_000);

afterAll(async () => {
  await ctx?.close();
});

describe('lint', () => {
  // -----------------------------------------------------------------------
  // Happy-path
  // -----------------------------------------------------------------------

  test('should lint a valid file and return diagnostics array', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'lint', {
      targets: [fixture],
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
    expect(structured.tool).toBe('oxlint');
    expect(Array.isArray(structured.diagnostics)).toBe(true);
  }, 30_000);

  test('should lint multiple files', async () => {
    // Arrange
    const targets = [
      path.join(ctx.fixturesAbs, 'sample.ts'),
      path.join(ctx.fixturesAbs, 'editable.ts'),
      path.join(ctx.fixturesAbs, 'lsp-target.ts'),
    ];
    // Act
    const { structured } = await callTool(ctx.client, 'lint', { targets });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
    expect(structured.tool).toBe('oxlint');
    expect(Array.isArray(structured.diagnostics)).toBe(true);
  }, 30_000);

  test('should lint a directory', async () => {
    // Arrange
    const dir = ctx.fixturesAbs;
    // Act
    const { structured } = await callTool(ctx.client, 'lint', {
      targets: [dir],
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
    expect(structured.tool).toBe('oxlint');
  }, 30_000);

  // -----------------------------------------------------------------------
  // Custom config
  // -----------------------------------------------------------------------

  test('should accept configPath argument without crashing', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'lint', {
      targets: [fixture],
      configPath: '/tmp/nonexistent-oxlintrc.json',
    });

    // Assert – may fail gracefully or succeed
    expect(structured).toBeDefined();
    expect(structured.tool).toBe('oxlint');
  }, 30_000);

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  test('should handle empty targets gracefully', async () => {
    // Arrange & Act
    const { structured } = await callToolSafe(ctx.client, 'lint', {
      targets: [],
    });

    // Assert
    expect(structured).toBeDefined();
    expect(structured.tool).toBe('oxlint');
  }, 30_000);

  test('should handle non-existent file', async () => {
    // Arrange
    const bogus = path.join(ctx.tmpRootAbs, 'phantom.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'lint', {
      targets: [bogus],
    });

    // Assert
    expect(structured).toBeDefined();
    expect(structured.tool).toBe('oxlint');
  }, 30_000);

  // -----------------------------------------------------------------------
  // Diagnostic structure validation
  // -----------------------------------------------------------------------

  test('should return diagnostics with proper structure when issues exist', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'lint', {
      targets: [fixture],
    });

    // Assert – if there are diagnostics, validate shape
    if (structured.diagnostics && structured.diagnostics.length > 0) {
      for (const diag of structured.diagnostics) {
        expect(typeof diag.message).toBe('string');
        expect(typeof diag.severity).toBe('string');
      }
    }
  }, 30_000);

  // -----------------------------------------------------------------------
  // Stress
  // -----------------------------------------------------------------------

  test('should handle 5 rapid sequential lint calls', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'sample.ts');

    // Act & Assert
    for (let i = 0; i < 5; i++) {
      const { structured } = await callToolSafe(ctx.client, 'lint', {
        targets: [fixture],
      });

      expect(structured).toBeDefined();
      expect(structured.tool).toBe('oxlint');
    }
  }, 60_000);
});
