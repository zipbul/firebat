import { mock, afterAll, describe, it, expect } from 'bun:test';
import * as nodePath from 'node:path';

const __origTsgoRunner = { ...require(nodePath.resolve(import.meta.dir, '../../tooling/tsgo/tsgo-runner.ts')) };
const __origSymbolIndex = { ...require(nodePath.resolve(import.meta.dir, '../symbol-index/symbol-index.usecases.ts')) };

// Mock tsgo-runner so withTsgoLspSession returns ok:false without spawning
mock.module(nodePath.resolve(import.meta.dir, '../../tooling/tsgo/tsgo-runner.ts'), () => ({
  withTsgoLspSession: async (_input: unknown, _fn: unknown) => ({ ok: false, error: 'tsgo not available in test' }),
  openTsDocument: async () => ({ uri: 'file:///test.ts', text: '' }),
  lspUriToFilePath: (uri: string) => uri.replace(/^file:\/\//, ''),
}));
mock.module(nodePath.resolve(import.meta.dir, '../symbol-index/symbol-index.usecases.ts'), () => ({
  indexSymbolsUseCase: async () => ({ ok: true, indexedFiles: 0, skippedFiles: 0, symbolsIndexed: 0, parseErrors: 0 }),
  searchSymbolFromIndexUseCase: async () => [],
}));

import {
  checkCapabilitiesUseCase,
  getHoverUseCase,
  getDefinitionsUseCase,
  getDiagnosticsUseCase,
  formatDocumentUseCase,
  getAvailableExternalSymbolsInFileUseCase,
  parseImportsUseCase,
} from './lsp.usecases';
import { createNoopLogger } from '../../ports/logger';

const logger = createNoopLogger('error');
const root = '/project';

describe('checkCapabilitiesUseCase', () => {
  it('should return ok:false when tsgo session fails', async () => {
    const result = await checkCapabilitiesUseCase({ root, logger });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('tsgo not available');
  });
});

describe('getHoverUseCase', () => {
  it('should return ok:false when tsgo session fails', async () => {
    const result = await getHoverUseCase({ root, filePath: 'src/a.ts', line: 1, logger });

    expect(result.ok).toBe(false);
  });
});

describe('getDefinitionsUseCase', () => {
  it('should return ok:false when tsgo session fails', async () => {
    const result = await getDefinitionsUseCase({ root, filePath: 'src/a.ts', line: 1, symbolName: '', logger });

    expect(result.ok).toBe(false);
  });
});

describe('getDiagnosticsUseCase', () => {
  it('should return ok:false when tsgo session fails', async () => {
    const result = await getDiagnosticsUseCase({ root, filePath: 'src/a.ts', logger });

    expect(result.ok).toBe(false);
  });
});

describe('formatDocumentUseCase', () => {
  it('should return ok:false when tsgo session fails', async () => {
    const result = await formatDocumentUseCase({ root, filePath: 'src/a.ts', logger });

    expect(result.ok).toBe(false);
  });
});

describe('getAvailableExternalSymbolsInFileUseCase', () => {
  it('should return ok:false when filePath is empty', async () => {
    const result = await getAvailableExternalSymbolsInFileUseCase({ root, filePath: '   ' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('required');
  });
});

describe('parseImportsUseCase', () => {
  it('should return ok:false when filePath is empty', async () => {
    const result = await parseImportsUseCase({ root, filePath: '' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('required');
  });
});

afterAll(() => {
  mock.restore();
  mock.module(nodePath.resolve(import.meta.dir, '../../tooling/tsgo/tsgo-runner.ts'), () => __origTsgoRunner);
  mock.module(nodePath.resolve(import.meta.dir, '../symbol-index/symbol-index.usecases.ts'), () => __origSymbolIndex);
});
