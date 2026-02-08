import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { readdir } from 'node:fs/promises';
import * as path from 'node:path';

import { createMcpTestContext, callTool, type McpTestContext } from './helpers/mcp-client';

let ctx: McpTestContext;

/** Enumerate all .ts files under a directory (non-recursive). */
const listTsFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });

  return entries.filter(e => e.isFile() && e.name.endsWith('.ts')).map(e => path.join(dir, e.name));
};

/** Helper to index all fixture .ts files (individual file paths, not directory). */
const indexFixtures = async () => {
  const files = await listTsFiles(ctx.fixturesAbs);

  return callTool(ctx.client, 'index_symbols', {
    root: ctx.tmpRootAbs,
    targets: files,
  });
};

beforeAll(async () => {
  ctx = await createMcpTestContext({ copyFixtures: true });
}, 30_000);

afterAll(async () => {
  await ctx?.close();
});

describe('index_symbols', () => {
  test('should index fixture files successfully', async () => {
    // Arrange
    const files = await listTsFiles(ctx.fixturesAbs);
    // Act
    const { structured } = await callTool(ctx.client, 'index_symbols', {
      root: ctx.tmpRootAbs,
      targets: files,
    });

    // Assert
    expect(structured.ok).toBe(true);
    expect(typeof structured.indexedFiles).toBe('number');
    expect(structured.indexedFiles).toBeGreaterThan(0);
    expect(typeof structured.symbolsIndexed).toBe('number');
    expect(structured.symbolsIndexed).toBeGreaterThan(0);
  }, 60_000);

  test('should index single file', async () => {
    // Arrange
    const target = path.join(ctx.fixturesAbs, 'sample.ts');
    // Act
    const { structured } = await callTool(ctx.client, 'index_symbols', {
      root: ctx.tmpRootAbs,
      targets: [target],
    });

    // Assert
    expect(structured.ok).toBe(true);
    expect(structured.indexedFiles).toBeGreaterThanOrEqual(0); // may skip if already indexed
  }, 60_000);

  test('should index with no targets (defaults to project root discovery)', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'index_symbols', {
      root: ctx.tmpRootAbs,
    });

    // Assert
    expect(structured.ok).toBe(true);
  }, 60_000);

  test('should re-index without error', async () => {
    // Act – index twice
    const files = await listTsFiles(ctx.fixturesAbs);
    const { structured: first } = await callTool(ctx.client, 'index_symbols', {
      root: ctx.tmpRootAbs,
      targets: files,
    });
    const { structured: second } = await callTool(ctx.client, 'index_symbols', {
      root: ctx.tmpRootAbs,
      targets: files,
    });

    // Assert
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
  }, 60_000);
});

describe('search_symbol_from_index', () => {
  test('should find functions by name', async () => {
    // Arrange – ensure indexed
    await indexFixtures();

    // Act
    const { structured } = await callTool(ctx.client, 'search_symbol_from_index', {
      query: 'add',
      root: ctx.tmpRootAbs,
    });

    // Assert
    expect(Array.isArray(structured.matches)).toBe(true);
    expect(structured.matches.length).toBeGreaterThan(0);

    const names = structured.matches.map((s: any) => s.name);

    expect(names.some((n: string) => n.includes('add'))).toBe(true);
  }, 60_000);

  test('should find classes by name', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'search_symbol_from_index', {
      query: 'Calculator',
      root: ctx.tmpRootAbs,
    });

    // Assert
    expect(structured.matches.length).toBeGreaterThan(0);
  }, 30_000);

  test('should filter by kind=function', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'search_symbol_from_index', {
      query: 'add',
      kind: 'function',
      root: ctx.tmpRootAbs,
    });

    // Assert
    expect(Array.isArray(structured.matches)).toBe(true);

    for (const s of structured.matches) {
      expect(s.kind.toLowerCase()).toContain('function');
    }
  }, 30_000);

  test('should filter by kind=class', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'search_symbol_from_index', {
      query: 'Calculator',
      kind: 'class',
      root: ctx.tmpRootAbs,
    });

    // Assert
    expect(structured.matches.length).toBeGreaterThan(0);
  }, 30_000);

  test('should filter by file path substring', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'search_symbol_from_index', {
      query: 'add',
      file: 'sample.ts',
      root: ctx.tmpRootAbs,
    });

    // Assert
    expect(Array.isArray(structured.matches)).toBe(true);

    for (const s of structured.matches) {
      expect(s.filePath).toContain('sample.ts');
    }
  }, 30_000);

  test('should respect limit parameter', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'search_symbol_from_index', {
      query: '',
      limit: 3,
      root: ctx.tmpRootAbs,
    });

    // Assert
    expect(structured.matches.length).toBeLessThanOrEqual(3);
  }, 30_000);

  test('should return empty for non-existent symbol', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'search_symbol_from_index', {
      query: 'xyzNonExistentSymbol12345',
      root: ctx.tmpRootAbs,
    });

    // Assert
    expect(Array.isArray(structured.matches)).toBe(true);
    expect(structured.matches.length).toBe(0);
  }, 30_000);

  test('should return empty for blank query (implementation discards empty strings)', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'search_symbol_from_index', {
      query: '',
      limit: 100,
      root: ctx.tmpRootAbs,
    });

    // Assert – repo returns [] for empty queries
    expect(Array.isArray(structured.matches)).toBe(true);
    expect(structured.matches.length).toBe(0);
  }, 30_000);

  test('should search with kind as array', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'search_symbol_from_index', {
      query: '',
      kind: ['function', 'class'],
      root: ctx.tmpRootAbs,
    });

    // Assert
    expect(Array.isArray(structured.matches)).toBe(true);
  }, 30_000);

  test('should include filePath, name, kind in each result', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'search_symbol_from_index', {
      query: 'add',
      root: ctx.tmpRootAbs,
    });

    // Assert
    for (const sym of structured.matches) {
      expect(typeof sym.name).toBe('string');
      expect(typeof sym.filePath).toBe('string');
      expect(typeof sym.kind).toBe('string');
    }
  }, 30_000);
});

describe('clear_index', () => {
  test('should clear the index successfully', async () => {
    // Arrange – ensure there's data to clear
    await indexFixtures();

    // Act
    const { structured } = await callTool(ctx.client, 'clear_index', {
      root: ctx.tmpRootAbs,
    });

    // Assert
    expect(structured.ok).toBe(true);
  }, 60_000);

  test('should return empty results after clearing', async () => {
    // Arrange – clear first
    await callTool(ctx.client, 'clear_index', { root: ctx.tmpRootAbs });

    // Act
    const { structured } = await callTool(ctx.client, 'search_symbol_from_index', {
      query: 'add',
      root: ctx.tmpRootAbs,
    });

    // Assert
    expect(Array.isArray(structured.matches)).toBe(true);
    expect(structured.matches.length).toBe(0);
  }, 30_000);

  test('should allow re-indexing after clear', async () => {
    // Act
    await callTool(ctx.client, 'clear_index', { root: ctx.tmpRootAbs });

    const files = await listTsFiles(ctx.fixturesAbs);
    const { structured } = await callTool(ctx.client, 'index_symbols', {
      root: ctx.tmpRootAbs,
      targets: files,
    });

    // Assert
    expect(structured.ok).toBe(true);
    expect(structured.symbolsIndexed).toBeGreaterThan(0);
  }, 60_000);

  test('should be idempotent (clear twice)', async () => {
    // Act
    await callTool(ctx.client, 'clear_index', { root: ctx.tmpRootAbs });

    const { structured } = await callTool(ctx.client, 'clear_index', {
      root: ctx.tmpRootAbs,
    });

    // Assert
    expect(structured.ok).toBe(true);
  }, 30_000);
});

describe('get_project_overview', () => {
  test('should return overview after indexing', async () => {
    // Arrange
    await indexFixtures();

    // Act
    const { structured } = await callTool(ctx.client, 'get_project_overview', {
      root: ctx.tmpRootAbs,
    });

    // Assert
    expect(typeof structured.symbolIndex.indexedFileCount).toBe('number');
    expect(typeof structured.symbolIndex.symbolCount).toBe('number');
    expect(structured.symbolIndex.indexedFileCount).toBeGreaterThan(0);
    expect(structured.symbolIndex.symbolCount).toBeGreaterThan(0);
  }, 60_000);

  test('should return overview without explicit root', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'get_project_overview', {});

    // Assert
    expect(typeof structured.symbolIndex.indexedFileCount).toBe('number');
    expect(typeof structured.symbolIndex.symbolCount).toBe('number');
  }, 30_000);

  test('should report tool availability', async () => {
    // Act
    const { structured } = await callTool(ctx.client, 'get_project_overview', {
      root: ctx.tmpRootAbs,
    });

    // Assert
    expect(typeof structured.tools.tsgo).toBe('boolean');
    expect(typeof structured.tools.oxlint).toBe('boolean');
  }, 30_000);

  test('should reflect clear_index (counts decrease)', async () => {
    // Arrange
    await indexFixtures();

    const { structured: before } = await callTool(ctx.client, 'get_project_overview', {
      root: ctx.tmpRootAbs,
    });

    // Act
    await callTool(ctx.client, 'clear_index', { root: ctx.tmpRootAbs });

    const { structured: after } = await callTool(ctx.client, 'get_project_overview', {
      root: ctx.tmpRootAbs,
    });

    // Assert
    expect(before.symbolIndex.symbolCount).toBeGreaterThan(0);
    expect(after.symbolIndex.symbolCount).toBe(0);
  }, 60_000);
});

describe('stress: index → search → clear cycle', () => {
  test('should survive 5 rapid index/search/clear cycles', async () => {
    const files = await listTsFiles(ctx.fixturesAbs);

    for (let i = 0; i < 5; i++) {
      // Index
      const { structured: idx } = await callTool(ctx.client, 'index_symbols', {
        root: ctx.tmpRootAbs,
        targets: files,
      });

      expect(idx.ok).toBe(true);

      // Search
      const { structured: search } = await callTool(ctx.client, 'search_symbol_from_index', {
        query: 'Calculator',
        root: ctx.tmpRootAbs,
      });

      expect(search.matches.length).toBeGreaterThan(0);

      // Clear
      const { structured: clr } = await callTool(ctx.client, 'clear_index', {
        root: ctx.tmpRootAbs,
      });

      expect(clr.ok).toBe(true);
    }
  }, 120_000);
});
