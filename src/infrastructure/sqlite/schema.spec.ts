import { describe, expect, it } from 'bun:test';

// schema.ts only exports Drizzle ORM table definitions (sqliteTable objects).
// We verify that each table is exported and has the expected column shape
// via the table's column descriptor — no actual DB connection needed.

import { artifacts, files, memories, symbolFiles, symbols } from './schema';

describe('infrastructure/sqlite/schema — table definitions', () => {
  it('files table is exported and has column descriptors', () => {
    expect(files).toBeDefined();
    const cols = Object.keys(files);
    expect(cols.length).toBeGreaterThan(0);
  });

  it('files table has projectKey and filePath columns', () => {
    const colNames = Object.keys(files);
    expect(colNames).toContain('projectKey');
    expect(colNames).toContain('filePath');
  });

  it('artifacts table is exported with kind and payloadJson columns', () => {
    expect(artifacts).toBeDefined();
    const colNames = Object.keys(artifacts);
    expect(colNames).toContain('kind');
    expect(colNames).toContain('payloadJson');
  });

  it('memories table is exported with memoryKey column', () => {
    expect(memories).toBeDefined();
    const colNames = Object.keys(memories);
    expect(colNames).toContain('memoryKey');
  });

  it('symbolFiles table is exported with contentHash and symbolCount columns', () => {
    expect(symbolFiles).toBeDefined();
    const colNames = Object.keys(symbolFiles);
    expect(colNames).toContain('contentHash');
    expect(colNames).toContain('symbolCount');
  });

  it('symbols table is exported with name, kind, startLine, isExported columns', () => {
    expect(symbols).toBeDefined();
    const colNames = Object.keys(symbols);
    expect(colNames).toContain('name');
    expect(colNames).toContain('kind');
    expect(colNames).toContain('startLine');
    expect(colNames).toContain('isExported');
  });

  it('all 5 tables are distinct objects', () => {
    const tables = [files, artifacts, memories, symbolFiles, symbols];
    const set = new Set(tables);
    expect(set.size).toBe(5);
  });
});
