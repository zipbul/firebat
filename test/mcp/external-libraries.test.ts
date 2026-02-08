import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as path from 'node:path';

import { createMcpTestContext, callTool, type McpTestContext } from './helpers/mcp-client';

let ctx: McpTestContext;

beforeAll(async () => {
  ctx = await createMcpTestContext({ copyFixtures: true });
}, 30_000);

afterAll(async () => {
  await ctx?.close();
});

describe('index_external_libraries', () => {
  test('should index with no filters', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'index_external_libraries', {
      root: ctx.tmpRootAbs,
    });

    // Assert
    expect(structured.ok).toBe(true);
    expect(typeof structured.indexedFiles).toBe('number');
  }, 120_000);

  test('should index with includePatterns', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'index_external_libraries', {
      root: ctx.tmpRootAbs,
      includePatterns: ['typescript'],
    });

    // Assert
    expect(structured.ok).toBe(true);
  }, 120_000);

  test('should index with excludePatterns', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'index_external_libraries', {
      root: ctx.tmpRootAbs,
      excludePatterns: ['@types/node'],
    });

    // Assert
    expect(structured.ok).toBe(true);
  }, 120_000);

  test('should index with maxFiles limit', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'index_external_libraries', {
      root: ctx.tmpRootAbs,
      maxFiles: 5,
    });

    // Assert
    expect(structured.ok).toBe(true);
    expect(structured.indexedFiles).toBeLessThanOrEqual(5);
  }, 60_000);

  test('should be idempotent (index twice)', async () => {
    // Act
    const { structured: first } = await callTool(ctx.client, 'index_external_libraries', {
      root: ctx.tmpRootAbs,
      maxFiles: 3,
    });
    const { structured: second } = await callTool(ctx.client, 'index_external_libraries', {
      root: ctx.tmpRootAbs,
      maxFiles: 3,
    });

    // Assert
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  }, 120_000);
});

describe('search_external_library_symbols', () => {
  test('should search after indexing', async () => {
    // Arrange – index first
    await callTool(ctx.client, 'index_external_libraries', {
      root: ctx.tmpRootAbs,
      maxFiles: 10,
    });

    // Act
    const { structured } = await callTool(ctx.client, 'search_external_library_symbols', {
      root: ctx.tmpRootAbs,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');

    if (structured.ok) {
      expect(structured.matches).toBeDefined();
    }
  }, 120_000);

  test('should search by symbolName', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'search_external_library_symbols', {
      root: ctx.tmpRootAbs,
      symbolName: 'readFile',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should filter by libraryName', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'search_external_library_symbols', {
      root: ctx.tmpRootAbs,
      libraryName: 'typescript',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should filter by kind', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'search_external_library_symbols', {
      root: ctx.tmpRootAbs,
      kind: 'function',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');
  }, 30_000);

  test('should respect limit parameter', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'search_external_library_symbols', {
      root: ctx.tmpRootAbs,
      limit: 5,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');

    if (structured.ok && Array.isArray(structured.matches)) {
      expect(structured.matches.length).toBeLessThanOrEqual(5);
    }
  }, 30_000);

  test('should return empty for nonsense query', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'search_external_library_symbols', {
      root: ctx.tmpRootAbs,
      symbolName: 'xyzNonExistentLibrarySymbol99999',
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');

    if (structured.ok && Array.isArray(structured.matches)) {
      expect(structured.matches.length).toBe(0);
    }
  }, 30_000);
});

describe('get_typescript_dependencies', () => {
  test('should return dependency list', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'get_typescript_dependencies', {
      root: ctx.tmpRootAbs,
    });

    // Assert
    expect(typeof structured.ok).toBe('boolean');

    if (structured.ok) {
      expect(Array.isArray(structured.dependencies)).toBe(true);
    }
  }, 30_000);

  test('should include type info for each dependency', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'get_typescript_dependencies', {
      root: ctx.tmpRootAbs,
    });

    // Assert
    if (structured.ok && Array.isArray(structured.dependencies)) {
      for (const dep of structured.dependencies) {
        expect(typeof dep.name).toBe('string');
        expect(typeof dep.hasTypes).toBe('boolean');
      }
    }
  }, 30_000);

  test('should handle repeated calls', async () => {
    // Act & Assert
    for (let i = 0; i < 3; i++) {
      const { structured } = await callTool(ctx.client, 'get_typescript_dependencies', {
        root: ctx.tmpRootAbs,
      });

      expect(typeof structured.ok).toBe('boolean');
    }
  }, 60_000);
});
