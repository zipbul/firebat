import { describe, expect, it } from 'bun:test';

import { artifacts, files, memories, symbolFiles, symbols } from './schema';

// Helpers that pull schema metadata out of drizzle-orm sqliteTable columns.
type ColumnLike = {
  readonly name: string;
  readonly dataType: string;
  readonly columnType: string;
  readonly notNull: boolean;
  readonly primary?: boolean;
  readonly autoIncrement?: boolean;
  readonly default?: unknown;
  readonly hasDefault?: boolean;
};

const expectStringColumn = (col: ColumnLike, expectedName: string, notNull: boolean): void => {
  expect(col.name).toBe(expectedName);
  expect(col.dataType).toBe('string');
  expect(col.columnType).toBe('SQLiteText');
  expect(col.notNull).toBe(notNull);
};

const expectIntegerColumn = (col: ColumnLike, expectedName: string, notNull: boolean): void => {
  expect(col.name).toBe(expectedName);
  expect(col.dataType).toBe('number');
  expect(col.columnType).toBe('SQLiteInteger');
  expect(col.notNull).toBe(notNull);
};

describe('infrastructure/sqlite/schema — files', () => {
  it('declares projectKey, filePath, mtimeMs, size, contentHash, updatedAt with correct types and NOT NULL', () => {
    expectStringColumn(files.projectKey, 'projectKey', true);
    expectStringColumn(files.filePath, 'filePath', true);
    expectIntegerColumn(files.mtimeMs, 'mtimeMs', true);
    expectIntegerColumn(files.size, 'size', true);
    expectStringColumn(files.contentHash, 'contentHash', true);
    expectIntegerColumn(files.updatedAt, 'updatedAt', true);
  });

  it('exposes exactly the documented columns (no accidental additions)', () => {
    const cols = Object.keys(files).filter(k => !k.startsWith('_'));

    expect(cols.sort()).toEqual(['contentHash', 'filePath', 'mtimeMs', 'projectKey', 'size', 'updatedAt']);
  });
});

describe('infrastructure/sqlite/schema — artifacts', () => {
  it('declares the artifact columns with correct types and NOT NULL', () => {
    expectStringColumn(artifacts.projectKey, 'projectKey', true);
    expectStringColumn(artifacts.kind, 'kind', true);
    expectStringColumn(artifacts.artifactKey, 'artifactKey', true);
    expectStringColumn(artifacts.inputsDigest, 'inputsDigest', true);
    expectIntegerColumn(artifacts.createdAt, 'createdAt', true);
    expectStringColumn(artifacts.payloadJson, 'payloadJson', true);
  });

  it('exposes exactly the documented columns', () => {
    const cols = Object.keys(artifacts).filter(k => !k.startsWith('_'));

    expect(cols.sort()).toEqual(['artifactKey', 'createdAt', 'inputsDigest', 'kind', 'payloadJson', 'projectKey']);
  });
});

describe('infrastructure/sqlite/schema — memories', () => {
  it('declares memory columns with correct types and NOT NULL', () => {
    expectStringColumn(memories.projectKey, 'projectKey', true);
    expectStringColumn(memories.memoryKey, 'memoryKey', true);
    expectIntegerColumn(memories.createdAt, 'createdAt', true);
    expectIntegerColumn(memories.updatedAt, 'updatedAt', true);
    expectStringColumn(memories.payloadJson, 'payloadJson', true);
  });
});

describe('infrastructure/sqlite/schema — symbolFiles', () => {
  it('declares symbol-file columns with correct types and NOT NULL', () => {
    expectStringColumn(symbolFiles.projectKey, 'projectKey', true);
    expectStringColumn(symbolFiles.filePath, 'filePath', true);
    expectStringColumn(symbolFiles.contentHash, 'contentHash', true);
    expectIntegerColumn(symbolFiles.indexedAt, 'indexedAt', true);
    expectIntegerColumn(symbolFiles.symbolCount, 'symbolCount', true);
  });
});

describe('infrastructure/sqlite/schema — symbols', () => {
  it('declares the symbol columns with correct types and NOT NULL', () => {
    expect(symbols.id.name).toBe('id');
    expect(symbols.id.dataType).toBe('number');
    expect(symbols.id.primary).toBe(true);
    // drizzle exposes autoIncrement on integer primary keys
    expect((symbols.id as unknown as { autoIncrement: boolean }).autoIncrement).toBe(true);

    expectStringColumn(symbols.projectKey, 'projectKey', true);
    expectStringColumn(symbols.filePath, 'filePath', true);
    expectStringColumn(symbols.kind, 'kind', true);
    expectStringColumn(symbols.name, 'name', true);
    expectIntegerColumn(symbols.startLine, 'startLine', true);
    expectIntegerColumn(symbols.startColumn, 'startColumn', true);
    expectIntegerColumn(symbols.endLine, 'endLine', true);
    expectIntegerColumn(symbols.endColumn, 'endColumn', true);
    expectIntegerColumn(symbols.indexedAt, 'indexedAt', true);
  });

  it('isExported is a boolean (sqlite integer with mode boolean) defaulting to false', () => {
    expect(symbols.isExported.name).toBe('isExported');
    expect(symbols.isExported.dataType).toBe('boolean');
    expect(symbols.isExported.columnType).toBe('SQLiteBoolean');
    expect(symbols.isExported.notNull).toBe(true);
    expect(symbols.isExported.default).toBe(false);
  });
});

describe('infrastructure/sqlite/schema — table identities', () => {
  it('exports five distinct sqliteTable objects', () => {
    const tables = [files, artifacts, memories, symbolFiles, symbols];

    expect(new Set(tables).size).toBe(5);
  });
});
