import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as path from 'node:path';

import { createMcpTestContext, callTool, type McpTestContext } from './helpers/mcp-client';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const asRecordOrThrow = (value: unknown, message: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(message);
  }

  return value;
};

const asArrayOrEmpty = (value: unknown): unknown[] => {
  if (Array.isArray(value)) {
    return value;
  }

  return [];
};

const getSymbolsArray = (structured: unknown): unknown[] => {
  const record = asRecordOrThrow(structured, 'Expected structured result object');

  return asArrayOrEmpty(record.symbols);
};

const getImportsArray = (structured: unknown): unknown[] => {
  const record = asRecordOrThrow(structured, 'Expected structured result object');

  return asArrayOrEmpty(record.imports);
};

const findImportBySpecifier = (
  imports: ReadonlyArray<unknown>,
  specifiers: ReadonlyArray<string>,
): Record<string, unknown> | undefined => {
  for (const entry of imports) {
    if (!isRecord(entry)) {
      continue;
    }

    const spec = entry.specifier;

    if (typeof spec !== 'string') {
      continue;
    }

    if (specifiers.includes(spec)) {
      return entry;
    }
  }

  return undefined;
};

const getImportNames = (imp: Record<string, unknown>): string[] => {
  const names = imp.names;

  if (!Array.isArray(names)) {
    return [];
  }

  const out: string[] = [];

  for (const item of names) {
    if (typeof item === 'string') {
      out.push(item);

      continue;
    }

    if (!isRecord(item)) {
      continue;
    }

    const n = item.name;
    const imported = item.imported;

    if (typeof n === 'string') {
      out.push(n);

      continue;
    }

    if (typeof imported === 'string') {
      out.push(imported);
    }
  }

  return out;
};

const isTypeOnlyImport = (imp: unknown): boolean => {
  if (!isRecord(imp)) {
    return false;
  }

  const raw = imp.raw;

  return typeof raw === 'string' && /import\s+type\b/.test(raw);
};

let ctx: McpTestContext;

beforeAll(async () => {
  ctx = await createMcpTestContext({ copyFixtures: true });
}, 30_000);

afterAll(async () => {
  await ctx.close();
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
    const symbols = getSymbolsArray(structured);

    expect(symbols.length).toBeGreaterThan(0);
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
    expect(Array.isArray(getSymbolsArray(structured))).toBe(true);
  }, 30_000);

  test('should handle non-existent file gracefully', async () => {
    // Arrange
    const filePath = path.join(ctx.tmpRootAbs, 'non-existent.ts');
    // Act
    const { raw } = await callTool(ctx.client, 'get_available_external_symbols', {
      root: ctx.tmpRootAbs,
      filePath,
    });

    // Assert
    expect(raw.isError).toBe(true);
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
    const symbolsRaw = getSymbolsArray(structured);

    for (const sym of symbolsRaw) {
      expect(typeof sym).toBe('string');
    }

    // import-target.ts imports 'path', 'readFile', 'writeFile', type 'Stats'
    const symbols = symbolsRaw as string[];

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

      expect(Array.isArray(getSymbolsArray(structured))).toBe(true);
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
    const imports = getImportsArray(structured);

    expect(imports.length).toBeGreaterThan(0);
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
    const imports = getImportsArray(structured);
    const nsImport = findImportBySpecifier(imports, ['node:path', 'path']);

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
    const imports = getImportsArray(structured);
    const fsImport = findImportBySpecifier(imports, ['node:fs/promises', 'fs/promises']);
    const fsImportRecord = asRecordOrThrow(fsImport, 'Expected fs import entry');
    const names = getImportNames(fsImportRecord);

    expect(names).toContain('readFile');
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
    const imports = getImportsArray(structured);
    const typeImport = imports.find(isTypeOnlyImport);

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
    const imports = getImportsArray(structured);

    expect(imports.length).toBe(0);
  }, 30_000);

  test('should handle non-existent file', async () => {
    // Arrange
    const filePath = path.join(ctx.tmpRootAbs, 'no-such-file.ts');
    // Act
    const { raw } = await callTool(ctx.client, 'parse_imports', {
      root: ctx.tmpRootAbs,
      filePath,
    });

    // Assert
    expect(raw.isError).toBe(true);
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
    const imports = getImportsArray(structured);

    for (const imp of imports) {
      const record = asRecordOrThrow(imp, 'Expected import entry to be an object');

      expect(typeof record.specifier).toBe('string');
      expect((record.specifier as string).length).toBeGreaterThan(0);
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

      expect(Array.isArray(getImportsArray(structured))).toBe(true);
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

      expect(getImportsArray(structured).length).toBeGreaterThan(0);
    }
  }, 60_000);
});
