import { describe, it, expect } from 'bun:test';
import { createInMemorySymbolIndexRepository } from './symbol-index.repository';

const makeSpan = () => ({
  start: { line: 1, column: 0 },
  end: { line: 1, column: 10 },
});

describe('createInMemorySymbolIndexRepository', () => {
  it('should return meta when getIndexedFile is called after replaceFileSymbols', async () => {
    // Arrange
    const repo = createInMemorySymbolIndexRepository();

    // Act
    await repo.replaceFileSymbols({
      projectKey: 'proj',
      filePath: '/src/app.ts',
      contentHash: 'abc',
      indexedAt: 1000,
      symbols: [{ kind: 'function', name: 'foo', span: makeSpan() }],
    });
    const result = await repo.getIndexedFile({ projectKey: 'proj', filePath: '/src/app.ts' });

    // Assert
    expect(result).not.toBeNull();
    expect(result!.contentHash).toBe('abc');
    expect(result!.indexedAt).toBe(1000);
    expect(result!.symbolCount).toBe(1);
  });

  it('should return null when getIndexedFile is called on a missing file', async () => {
    // Arrange
    const repo = createInMemorySymbolIndexRepository();

    // Act
    const result = await repo.getIndexedFile({ projectKey: 'proj', filePath: '/missing.ts' });

    // Assert
    expect(result).toBeNull();
  });

  it('should return matching symbols when search is called with a partial name', async () => {
    // Arrange
    const repo = createInMemorySymbolIndexRepository();
    await repo.replaceFileSymbols({
      projectKey: 'proj',
      filePath: '/src/util.ts',
      contentHash: 'h',
      indexedAt: 1,
      symbols: [
        { kind: 'function', name: 'computeTotal', span: makeSpan() },
        { kind: 'function', name: 'parseInput', span: makeSpan() },
      ],
    });

    // Act
    const results = await repo.search({ projectKey: 'proj', query: 'compute' });

    // Assert
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('computeTotal');
    expect(results[0].filePath).toBe('/src/util.ts');
  });

  it('should return empty array when search is called with empty query', async () => {
    // Arrange
    const repo = createInMemorySymbolIndexRepository();
    await repo.replaceFileSymbols({
      projectKey: 'proj',
      filePath: '/src/a.ts',
      contentHash: 'h',
      indexedAt: 1,
      symbols: [{ kind: 'function', name: 'foo', span: makeSpan() }],
    });

    // Act
    const results = await repo.search({ projectKey: 'proj', query: '' });

    // Assert
    expect(results).toHaveLength(0);
  });

  it('should return empty array when search is called with whitespace-only query', async () => {
    // Arrange
    const repo = createInMemorySymbolIndexRepository();
    await repo.replaceFileSymbols({
      projectKey: 'proj',
      filePath: '/src/a.ts',
      contentHash: 'h',
      indexedAt: 1,
      symbols: [{ kind: 'function', name: 'bar', span: makeSpan() }],
    });

    // Act
    const results = await repo.search({ projectKey: 'proj', query: '   ' });

    // Assert
    expect(results).toHaveLength(0);
  });

  it('should apply default limit of 50 when limit is undefined', async () => {
    // Arrange
    const repo = createInMemorySymbolIndexRepository();
    const symbols = Array.from({ length: 60 }, (_, i) => ({
      kind: 'function' as const,
      name: `func${i}`,
      span: makeSpan(),
    }));
    await repo.replaceFileSymbols({ projectKey: 'proj', filePath: '/big.ts', contentHash: 'h', indexedAt: 1, symbols });

    // Act
    const results = await repo.search({ projectKey: 'proj', query: 'func' });

    // Assert
    expect(results).toHaveLength(50);
  });

  it('should apply default limit of 50 when limit is 0', async () => {
    // Arrange
    const repo = createInMemorySymbolIndexRepository();
    const symbols = Array.from({ length: 60 }, (_, i) => ({
      kind: 'function' as const,
      name: `fn${i}`,
      span: makeSpan(),
    }));
    await repo.replaceFileSymbols({ projectKey: 'proj', filePath: '/big.ts', contentHash: 'h', indexedAt: 1, symbols });

    // Act
    const results = await repo.search({ projectKey: 'proj', query: 'fn', limit: 0 });

    // Assert
    expect(results).toHaveLength(50);
  });

  it('should truncate results when search exceeds limit', async () => {
    // Arrange
    const repo = createInMemorySymbolIndexRepository();
    const symbols = Array.from({ length: 10 }, (_, i) => ({
      kind: 'function' as const,
      name: `item${i}`,
      span: makeSpan(),
    }));
    await repo.replaceFileSymbols({ projectKey: 'proj', filePath: '/f.ts', contentHash: 'h', indexedAt: 1, symbols });

    // Act
    const results = await repo.search({ projectKey: 'proj', query: 'item', limit: 3 });

    // Assert
    expect(results).toHaveLength(3);
  });

  it('should return accurate fileCount/symbolCount/lastIndexedAt from getStats', async () => {
    // Arrange
    const repo = createInMemorySymbolIndexRepository();
    await repo.replaceFileSymbols({
      projectKey: 'proj', filePath: '/a.ts', contentHash: 'h1', indexedAt: 500,
      symbols: [{ kind: 'function', name: 'f1', span: makeSpan() }, { kind: 'class', name: 'C1', span: makeSpan() }],
    });
    await repo.replaceFileSymbols({
      projectKey: 'proj', filePath: '/b.ts', contentHash: 'h2', indexedAt: 800,
      symbols: [{ kind: 'method', name: 'm1', span: makeSpan() }],
    });

    // Act
    const stats = await repo.getStats({ projectKey: 'proj' });

    // Assert
    expect(stats.indexedFileCount).toBe(2);
    expect(stats.symbolCount).toBe(3);
    expect(stats.lastIndexedAt).toBe(800);
  });

  it('should return 0/0/null from getStats when project is empty', async () => {
    // Arrange
    const repo = createInMemorySymbolIndexRepository();

    // Act
    const stats = await repo.getStats({ projectKey: 'no-such-project' });

    // Assert
    expect(stats.indexedFileCount).toBe(0);
    expect(stats.symbolCount).toBe(0);
    expect(stats.lastIndexedAt).toBeNull();
  });

  it('should track maximum lastIndexedAt across multiple files', async () => {
    // Arrange
    const repo = createInMemorySymbolIndexRepository();
    await repo.replaceFileSymbols({ projectKey: 'proj', filePath: '/a.ts', contentHash: 'h1', indexedAt: 100, symbols: [] });
    await repo.replaceFileSymbols({ projectKey: 'proj', filePath: '/b.ts', contentHash: 'h2', indexedAt: 999, symbols: [] });
    await repo.replaceFileSymbols({ projectKey: 'proj', filePath: '/c.ts', contentHash: 'h3', indexedAt: 50, symbols: [] });

    // Act
    const stats = await repo.getStats({ projectKey: 'proj' });

    // Assert
    expect(stats.lastIndexedAt).toBe(999);
  });

  it('should reset stats after clearProject is called', async () => {
    // Arrange
    const repo = createInMemorySymbolIndexRepository();
    await repo.replaceFileSymbols({ projectKey: 'proj', filePath: '/a.ts', contentHash: 'h', indexedAt: 1, symbols: [{ kind: 'function', name: 'f', span: makeSpan() }] });

    // Act
    await repo.clearProject({ projectKey: 'proj' });
    const stats = await repo.getStats({ projectKey: 'proj' });

    // Assert
    expect(stats.indexedFileCount).toBe(0);
    expect(stats.symbolCount).toBe(0);
  });

  it('should allow replaceFileSymbols after clearProject', async () => {
    // Arrange
    const repo = createInMemorySymbolIndexRepository();
    await repo.replaceFileSymbols({ projectKey: 'proj', filePath: '/a.ts', contentHash: 'h1', indexedAt: 1, symbols: [] });
    await repo.clearProject({ projectKey: 'proj' });

    // Act
    await repo.replaceFileSymbols({ projectKey: 'proj', filePath: '/a.ts', contentHash: 'h2', indexedAt: 2, symbols: [{ kind: 'enum', name: 'E', span: makeSpan() }] });
    const result = await repo.getIndexedFile({ projectKey: 'proj', filePath: '/a.ts' });

    // Assert
    expect(result!.contentHash).toBe('h2');
    expect(result!.symbolCount).toBe(1);
  });

  it('should match symbols case-insensitively when search is called', async () => {
    // Arrange
    const repo = createInMemorySymbolIndexRepository();
    await repo.replaceFileSymbols({
      projectKey: 'proj', filePath: '/f.ts', contentHash: 'h', indexedAt: 1,
      symbols: [{ kind: 'class', name: 'MyWidget', span: makeSpan() }],
    });

    // Act
    const results = await repo.search({ projectKey: 'proj', query: 'WIDGET' });

    // Assert
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('MyWidget');
  });

  it('should isolate data across different projectKeys', async () => {
    // Arrange
    const repo = createInMemorySymbolIndexRepository();
    await repo.replaceFileSymbols({ projectKey: 'A', filePath: '/f.ts', contentHash: 'h', indexedAt: 1, symbols: [{ kind: 'function', name: 'f', span: makeSpan() }] });

    // Act
    const stats = await repo.getStats({ projectKey: 'B' });
    const result = await repo.getIndexedFile({ projectKey: 'B', filePath: '/f.ts' });

    // Assert
    expect(stats.indexedFileCount).toBe(0);
    expect(result).toBeNull();
  });
});
