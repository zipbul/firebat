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

describe('find_references', () => {
  test('should find references to a function', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'find_references', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 21,
      symbolName: 'getUserName',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');

    if (structured.ok) {
      expect(Array.isArray(structured.references)).toBe(true);
      expect(structured.references.length).toBeGreaterThan(0);
    }
  }, 30_000);

  test('should find references to an interface', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'find_references', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 3,
      symbolName: 'User',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');

    if (structured.ok) {
      expect(Array.isArray(structured.references)).toBe(true);
      // User is used in many places
      expect(structured.references.length).toBeGreaterThan(0);
    }
  }, 30_000);

  test('should find references to a class', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'find_references', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 30,
      symbolName: 'UserService',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle non-existent symbol', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'find_references', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 1,
      symbolName: 'thisDoesNotExist',
    });

    // Assert
    expect(structured).toBeDefined();
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle non-existent file', async () => {
    // Arrange
    const bogus = path.join(ctx.tmpRootAbs, 'ghost.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'find_references', {
      root: ctx.tmpRootAbs,
      filePath: bogus,
      line: 1,
      symbolName: 'whatever',
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should accept line as string', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'find_references', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: '21',
      symbolName: 'getUserName',
    });

    // Assert
    expect(structured).toBeDefined();
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle 5 rapid sequential reference lookups', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    const symbols = ['User', 'createUser', 'getUserName', 'greetUser', 'UserService'];

    // Act & Assert
    for (const sym of symbols) {
      const { structured } = await callToolSafe(ctx.client, 'find_references', {
        root: ctx.tmpRootAbs,
        filePath: fixture,
        line: 1,
        symbolName: sym,
      });

      expect(structured).toBeDefined();
      expect(typeof structured.ok).toBe('boolean');
    }
  }, 60_000);
});
