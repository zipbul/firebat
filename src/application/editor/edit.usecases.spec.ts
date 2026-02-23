import { mock, afterAll, describe, it, expect, spyOn, afterEach } from 'bun:test';
import * as nodePath from 'node:path';

const __origSymbolIndexUsecases = { ...require(nodePath.resolve(import.meta.dir, '../symbol-index/symbol-index.usecases.ts')) };

// Mock indexSymbolsUseCase to prevent heavy infra during reindex
mock.module(nodePath.resolve(import.meta.dir, '../symbol-index/symbol-index.usecases.ts'), () => ({
  indexSymbolsUseCase: async () => ({ ok: true, indexedFiles: 0, skippedFiles: 0, symbolsIndexed: 0, parseErrors: 0 }),
}));

import {
  replaceRangeUseCase,
  replaceRegexUseCase,
} from './edit.usecases';
import { createNoopLogger } from '../../shared/logger';

const logger = createNoopLogger('error');

let fileSpy: ReturnType<typeof spyOn>;
let writeSpy: ReturnType<typeof spyOn>;

afterEach(() => {
  fileSpy?.mockRestore();
  writeSpy?.mockRestore();
});

const mockFile = (content: string) => {
  fileSpy = spyOn(Bun, 'file').mockReturnValue({ text: async () => content } as never);
  writeSpy = spyOn(Bun, 'write').mockResolvedValue(content.length);
};

describe('replaceRangeUseCase', () => {
  it('should return ok:false when relativePath is empty', async () => {
    const result = await replaceRangeUseCase({
      root: '/project',
      relativePath: '  ',
      startLine: 1, startColumn: 1,
      endLine: 1, endColumn: 1,
      newText: '',
      logger,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('required');
  });

  it('should return ok:true and changed:false when content is unchanged', async () => {
    const original = 'const x = 1;\n';
    mockFile(original);

    // Replace "1" at line 1, col 11-12 (1-based: col 11=`1`, col 12=`;`) with same "1"
    const result = await replaceRangeUseCase({
      root: '/project',
      relativePath: 'src/a.ts',
      startLine: 1, startColumn: 11,
      endLine: 1, endColumn: 12,
      newText: '1',
      logger,
    });

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
  });

  it('should return ok:true and changed:true when content changes', async () => {
    const original = 'const x = 1;\n';
    mockFile(original);

    const result = await replaceRangeUseCase({
      root: '/project',
      relativePath: 'src/a.ts',
      startLine: 1, startColumn: 11,
      endLine: 1, endColumn: 12,
      newText: '42',
      logger,
    });

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
  });

  it('should return ok:false when Bun.file throws', async () => {
    fileSpy = spyOn(Bun, 'file').mockReturnValue({ text: async () => { throw new Error('ENOENT'); } } as never);

    const result = await replaceRangeUseCase({
      root: '/project',
      relativePath: 'src/missing.ts',
      startLine: 1, startColumn: 1,
      endLine: 1, endColumn: 1,
      newText: '',
      logger,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('ENOENT');
  });
});

describe('replaceRegexUseCase', () => {
  it('should return ok:false when relativePath is empty', async () => {
    const result = await replaceRegexUseCase({
      root: '/project',
      relativePath: '',
      regex: 'foo',
      repl: 'bar',
      logger,
    });

    expect(result.ok).toBe(false);
  });

  it('should return ok:true matchCount:0 when pattern not found', async () => {
    mockFile('const x = 1;\n');

    const result = await replaceRegexUseCase({
      root: '/project',
      relativePath: 'src/a.ts',
      regex: 'notfound',
      repl: 'bar',
      logger,
    });

    expect(result.ok).toBe(true);
    expect(result.matchCount).toBe(0);
    expect(result.changed).toBe(false);
  });

  it('should return ok:true changed:true when pattern matched and replaced', async () => {
    mockFile('const foo = 1; const foo2 = 2;\n');

    const result = await replaceRegexUseCase({
      root: '/project',
      relativePath: 'src/a.ts',
      regex: 'foo',
      repl: 'bar',
      logger,
    });

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.matchCount).toBeGreaterThanOrEqual(1);
  });

  it('should replace all occurrences when allowMultipleOccurrences is true', async () => {
    mockFile('foo foo foo\n');
    writeSpy = spyOn(Bun, 'write').mockResolvedValue(11);

    const result = await replaceRegexUseCase({
      root: '/project',
      relativePath: 'src/a.ts',
      regex: 'foo',
      repl: 'bar',
      allowMultipleOccurrences: true,
      logger,
    });

    expect(result.ok).toBe(true);
    expect(result.matchCount).toBe(3);
  });

  it('should return ok:false when Bun.file throws', async () => {
    fileSpy = spyOn(Bun, 'file').mockReturnValue({ text: async () => { throw new Error('ENOENT'); } } as never);

    const result = await replaceRegexUseCase({
      root: '/project',
      relativePath: 'src/a.ts',
      regex: 'foo',
      repl: 'bar',
      logger,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('ENOENT');
  });
});

afterAll(() => {
  mock.restore();
  mock.module(nodePath.resolve(import.meta.dir, '../symbol-index/symbol-index.usecases.ts'), () => __origSymbolIndexUsecases);
});
