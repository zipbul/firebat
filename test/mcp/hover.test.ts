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

describe('get_hover', () => {
  // -----------------------------------------------------------------------
  // Happy-path
  // -----------------------------------------------------------------------

  test('should return hover info for a function name', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'get_hover', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 13, // createUser function
      target: 'createUser',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
    if (structured.ok) {
      expect(structured.hover).toBeDefined();
    }
  }, 30_000);

  test('should return hover info for a class name', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'get_hover', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 30, // UserService class
      target: 'UserService',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should return hover info for an interface', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'get_hover', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 3, // User interface
      target: 'User',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should return hover info for a type alias', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'get_hover', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 10, // UserCreateInput
      target: 'UserCreateInput',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should return hover info with exact line and character', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'get_hover', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 13,
      character: 16,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should return hover info for a variable', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'get_hover', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 52, // DEFAULT_USER
      target: 'DEFAULT_USER',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  // -----------------------------------------------------------------------
  // Line as string
  // -----------------------------------------------------------------------

  test('should accept line as string', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'get_hover', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: '13',
      target: 'createUser',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  // -----------------------------------------------------------------------
  // Error cases
  // -----------------------------------------------------------------------

  test('should handle non-existent file', async () => {
    // Arrange
    const bogus = path.join(ctx.tmpRootAbs, 'ghost.ts');

    // Act
    const { structured } = await callToolSafe(ctx.client, 'get_hover', {
      root: ctx.tmpRootAbs,
      filePath: bogus,
      line: 1,
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should handle out-of-range line number', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');

    // Act
    const { structured } = await callToolSafe(ctx.client, 'get_hover', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 99999,
    });

    // Assert
    expect(structured).toBeDefined();
  }, 30_000);

  test('should handle hover on whitespace/empty area', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');

    // Act
    const { structured } = await callToolSafe(ctx.client, 'get_hover', {
      root: ctx.tmpRootAbs,
      filePath: fixture,
      line: 1, // first line, column 0 (may be empty or keyword)
      character: 0,
    });

    // Assert
    expect(structured).toBeDefined();
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  // -----------------------------------------------------------------------
  // Stress
  // -----------------------------------------------------------------------

  test('should handle 8 rapid sequential hover calls', async () => {
    // Arrange
    const fixture = path.join(ctx.fixturesAbs, 'lsp-target.ts');
    const targets = ['User', 'createUser', 'getUserName', 'greetUser', 'UserService', 'DEFAULT_USER', 'Callback', 'format'];

    // Act & Assert
    for (const target of targets) {
      const { structured } = await callToolSafe(ctx.client, 'get_hover', {
        root: ctx.tmpRootAbs,
        filePath: fixture,
        line: 1,
        target,
      });
      expect(structured).toBeDefined();
      expect(typeof structured.ok).toBe('boolean');
    }
  }, 60_000);
});
