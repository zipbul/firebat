import { describe, it, expect } from 'bun:test';
import type {
  IndexedSymbolKind,
  IndexedSymbol,
  SymbolMatch,
  SymbolIndexStats,
  SearchSymbolsInput,
  SymbolIndexRepository,
} from './symbol-index.repository';

describe('IndexedSymbolKind', () => {
  it('should accept all 6 literal values when assigned', () => {
    const kinds: IndexedSymbolKind[] = [
      'function',
      'method',
      'class',
      'type',
      'interface',
      'enum',
    ];

    expect(kinds).toHaveLength(6);
    expect(kinds).toContain('function');
    expect(kinds).toContain('method');
    expect(kinds).toContain('class');
    expect(kinds).toContain('type');
    expect(kinds).toContain('interface');
    expect(kinds).toContain('enum');
  });
});

describe('IndexedSymbol', () => {
  it('should satisfy required fields with optional isExported when assigned', () => {
    const sym: IndexedSymbol = {
      kind: 'function',
      name: 'myFunc',
      span: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
      isExported: true,
    };

    expect(sym.kind).toBe('function');
    expect(sym.name).toBe('myFunc');
    expect(sym.span.start.line).toBe(1);
    expect(sym.isExported).toBe(true);
  });

  it('should accept undefined isExported when assigned', () => {
    const sym: IndexedSymbol = {
      kind: 'class',
      name: 'MyClass',
      span: { start: { line: 0, column: 0 }, end: { line: 2, column: 0 } },
    };

    expect(sym.isExported).toBeUndefined();
  });
});

describe('SymbolMatch', () => {
  it('should satisfy all fields including optional isExported when assigned', () => {
    const match: SymbolMatch = {
      filePath: '/src/util.ts',
      kind: 'method',
      name: 'compute',
      span: { start: { line: 10, column: 0 }, end: { line: 15, column: 2 } },
      isExported: false,
    };

    expect(match.filePath).toBe('/src/util.ts');
    expect(match.kind).toBe('method');
    expect(match.name).toBe('compute');
    expect(match.span.start.line).toBe(10);
    expect(match.isExported).toBe(false);
  });
});

describe('SymbolIndexStats', () => {
  it('should accept null lastIndexedAt when assigned', () => {
    const stats: SymbolIndexStats = {
      indexedFileCount: 10,
      symbolCount: 200,
      lastIndexedAt: null,
    };

    expect(stats.lastIndexedAt).toBeNull();
    expect(stats.indexedFileCount).toBe(10);
    expect(stats.symbolCount).toBe(200);
  });

  it('should accept zero counts when assigned', () => {
    const stats: SymbolIndexStats = {
      indexedFileCount: 0,
      symbolCount: 0,
      lastIndexedAt: null,
    };

    expect(stats.indexedFileCount).toBe(0);
    expect(stats.symbolCount).toBe(0);
  });
});

describe('SearchSymbolsInput', () => {
  it('should accept undefined limit when assigned', () => {
    const input: SearchSymbolsInput = {
      projectKey: 'proj',
      query: 'myFunc',
    };

    expect(input.limit).toBeUndefined();
  });
});

describe('SymbolIndexRepository', () => {
  it('should be implementable with 5 methods when mocked', () => {
    const repo: SymbolIndexRepository = {
      getIndexedFile: async () => null,
      replaceFileSymbols: async () => undefined,
      search: async () => [],
      getStats: async () => ({
        indexedFileCount: 0,
        symbolCount: 0,
        lastIndexedAt: null,
      }),
      clearProject: async () => undefined,
    };

    expect(typeof repo.getIndexedFile).toBe('function');
    expect(typeof repo.replaceFileSymbols).toBe('function');
    expect(typeof repo.search).toBe('function');
    expect(typeof repo.getStats).toBe('function');
    expect(typeof repo.clearProject).toBe('function');
  });
});
