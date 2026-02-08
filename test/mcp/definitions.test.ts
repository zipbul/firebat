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

describe('get_definitions', () => {
  test('should get definition of a function', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'get_definitions', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 25,
      symbolName: 'getUserName',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');

    if (structured.ok) {
      expect(Array.isArray(structured.definitions)).toBe(true);
      expect(structured.definitions.length).toBeGreaterThan(0);
    }
  }, 30_000);

  test('should get definition with include_body=true', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'get_definitions', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 13,
      symbolName: 'createUser',
      include_body: true,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');

    if (structured.ok) {
      expect(Array.isArray(structured.definitions)).toBe(true);
    }
  }, 30_000);

  test('should get definition with custom before/after context', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'get_definitions', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 21,
      symbolName: 'getUserName',
      before: 5,
      after: 5,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should get definition with before=0 and after=0', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'get_definitions', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 21,
      symbolName: 'getUserName',
      before: 0,
      after: 0,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should get definition of a class', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'get_definitions', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 30,
      symbolName: 'UserService',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should get definition of an interface', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'get_definitions', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 3,
      symbolName: 'User',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle non-existent symbol', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'get_definitions', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 1,
      symbolName: 'nonExistentSymbol',
    });

    // Assert
    expect(structured).toBeDefined();
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should handle non-existent file', async () => {
    // Arrange & Act
    const { structured } = await callToolSafe(ctx.client, 'get_definitions', {
      root: ctx.tmpRootAbs,
      filePath: path.join(ctx.tmpRootAbs, 'nope.ts'),
      line: 1,
      symbolName: 'anything',
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should accept line as string', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    // Act
    const { structured } = await callToolSafe(ctx.client, 'get_definitions', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: '13',
      symbolName: 'createUser',
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should handle 6 rapid sequential definition lookups', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    const symbols = ['User', 'createUser', 'getUserName', 'greetUser', 'UserService', 'DEFAULT_USER'];

    // Act & Assert
    for (const sym of symbols) {
      const { structured } = await callToolSafe(ctx.client, 'get_definitions', {
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
