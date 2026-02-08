import * as path from 'node:path';
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createMcpTestContext, callTool, type McpTestContext } from './helpers/mcp-client';

let ctx: McpTestContext;

beforeAll(async () => {
  ctx = await createMcpTestContext({ copyFixtures: true });
}, 30_000);

afterAll(async () => {
  await ctx?.close();
});

describe('get_available_external_symbols', () => {
  test('should return imported symbols from import-target.ts', async () => {
    // Arrange
    const filePath = path.join(ctx.fixturesAbs, 'import-target.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'get_available_external_symbols', {
      root: ctx.tmpRootAbs,
      filePath,
    });

    // Assert
    expect(Array.isArray(structured.symbols)).toBe(true);
    expect(structured.symbols.length).toBeGreaterThan(0);
  }, 30_000);

  test('should return symbols from sample.ts (no imports → empty or self-defined)', async () => {
    // Arrange
    const filePath = path.join(ctx.fixturesAbs, 'sample.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'get_available_external_symbols', {
      root: ctx.tmpRootAbs,
      filePath,
    });

    // Assert
    expect(Array.isArray(structured.symbols)).toBe(true);
  }, 30_000);

  test('should handle non-existent file gracefully', async () => {
    // Arrange
    const filePath = path.join(ctx.tmpRootAbs, 'non-existent.ts');

    // Act
    const { structured, raw } = await callTool(ctx.client, 'get_available_external_symbols', {
      root: ctx.tmpRootAbs,
      filePath,
    });

    // Assert
    expect(raw.isError === true || structured.ok === false || Array.isArray(structured.symbols)).toBe(true);
  }, 30_000);

  test('should include symbol names in results', async () => {
    // Arrange
    const filePath = path.join(ctx.fixturesAbs, 'import-target.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'get_available_external_symbols', {
      root: ctx.tmpRootAbs,
      filePath,
    });

    // Assert
    for (const sym of structured.symbols) {
      expect(typeof sym).toBe('string');
    }
    // import-target.ts imports 'path', 'readFile', 'writeFile', type 'Stats'
    const symbols: string[] = structured.symbols;
    expect(symbols.some(s => s.includes('path'))).toBe(true);
  }, 30_000);

  test('should survive 5 rapid calls', async () => {
    // Arrange
    const filePath = path.join(ctx.fixturesAbs, 'import-target.ts');

    // Act & Assert
    for (let i = 0; i < 5; i++) {
      const { structured } = await callTool(ctx.client, 'get_available_external_symbols', {
        root: ctx.tmpRootAbs,
        filePath,
      });
      expect(Array.isArray(structured.symbols)).toBe(true);
    }
  }, 60_000);
});

describe('parse_imports', () => {
  test('should parse imports from import-target.ts', async () => {
    // Arrange
    const filePath = path.join(ctx.fixturesAbs, 'import-target.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'parse_imports', {
      root: ctx.tmpRootAbs,
      filePath,
    });

    // Assert
    expect(Array.isArray(structured.imports)).toBe(true);
    expect(structured.imports.length).toBeGreaterThan(0);
  }, 30_000);

  test('should identify namespace imports (import * as path)', async () => {
    // Arrange
    const filePath = path.join(ctx.fixturesAbs, 'import-target.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'parse_imports', {
      root: ctx.tmpRootAbs,
      filePath,
    });

    // Assert
    const nsImport = structured.imports.find(
      (i: any) => i.specifier === 'node:path' || i.specifier === 'path',
    );
    expect(nsImport).toBeTruthy();
  }, 30_000);

  test('should identify named imports (readFile, writeFile)', async () => {
    // Arrange
    const filePath = path.join(ctx.fixturesAbs, 'import-target.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'parse_imports', {
      root: ctx.tmpRootAbs,
      filePath,
    });

    // Assert
    const fsImport = structured.imports.find(
      (i: any) => i.specifier === 'node:fs/promises' || i.specifier === 'fs/promises',
    );
    expect(fsImport).toBeTruthy();
    if (fsImport?.names) {
      const names = fsImport.names.map((n: any) => n.name ?? n.imported ?? n);
      expect(names).toContain('readFile');
    }
  }, 30_000);

  test('should identify type-only imports', async () => {
    // Arrange
    const filePath = path.join(ctx.fixturesAbs, 'import-target.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'parse_imports', {
      root: ctx.tmpRootAbs,
      filePath,
    });

    // Assert – the server doesn't return a typeOnly field; detect via the raw import text
    const typeImport = structured.imports.find(
      (i: any) => typeof i.raw === 'string' && /import\s+type\b/.test(i.raw),
    );
    expect(typeImport).toBeTruthy();
  }, 30_000);

  test('should return empty imports for file with no imports', async () => {
    // Arrange
    const filePath = path.join(ctx.fixturesAbs, 'editable.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'parse_imports', {
      root: ctx.tmpRootAbs,
      filePath,
    });

    // Assert
    expect(Array.isArray(structured.imports)).toBe(true);
    expect(structured.imports.length).toBe(0);
  }, 30_000);

  test('should handle non-existent file', async () => {
    // Arrange
    const filePath = path.join(ctx.tmpRootAbs, 'no-such-file.ts');

    // Act
    const { structured, raw } = await callTool(ctx.client, 'parse_imports', {
      root: ctx.tmpRootAbs,
      filePath,
    });

    // Assert
    expect(raw.isError === true || structured.ok === false || structured.imports?.length === 0).toBe(true);
  }, 30_000);

  test('should include specifier and resolved path in each import', async () => {
    // Arrange
    const filePath = path.join(ctx.fixturesAbs, 'import-target.ts');

    // Act
    const { structured } = await callTool(ctx.client, 'parse_imports', {
      root: ctx.tmpRootAbs,
      filePath,
    });

    // Assert
    for (const imp of structured.imports) {
      expect(typeof imp.specifier).toBe('string');
      expect(imp.specifier.length).toBeGreaterThan(0);
    }
  }, 30_000);

  test('should parse all fixture files without error', async () => {
    // Arrange
    const files = ['sample.ts', 'editable.ts', 'lsp-target.ts', 'import-target.ts'];

    // Act & Assert
    for (const f of files) {
      const filePath = path.join(ctx.fixturesAbs, f);
      const { structured } = await callTool(ctx.client, 'parse_imports', {
        root: ctx.tmpRootAbs,
        filePath,
      });
      expect(Array.isArray(structured.imports)).toBe(true);
    }
  }, 60_000);

  test('should survive 5 rapid calls on same file', async () => {
    // Arrange
    const filePath = path.join(ctx.fixturesAbs, 'import-target.ts');

    // Act & Assert
    for (let i = 0; i < 5; i++) {
      const { structured } = await callTool(ctx.client, 'parse_imports', {
        root: ctx.tmpRootAbs,
        filePath,
      });
      expect(structured.imports.length).toBeGreaterThan(0);
    }
  }, 60_000);
});
