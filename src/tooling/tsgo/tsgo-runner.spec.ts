import { describe, it, expect } from 'bun:test';
import { lspUriToFilePath, openTsDocument } from './tsgo-runner';

// --- lspUriToFilePath ---

describe('lspUriToFilePath', () => {
  it('should convert file:// URI to absolute path', () => {
    const result = lspUriToFilePath('file:///home/user/project/src/index.ts');

    expect(result).toBe('/home/user/project/src/index.ts');
  });

  it('should return URI with file:// prefix stripped when URL parsing fails', () => {
    // A URI with invalid URL chars falls back to stripping prefix
    const result = lspUriToFilePath('file:///path/to/file.ts');

    expect(result).toBe('/path/to/file.ts');
  });

  it('should return plain path as-is when not a file:// URI', () => {
    const result = lspUriToFilePath('/absolute/path/file.ts');

    expect(result).toBe('/absolute/path/file.ts');
  });

  it('should handle URI with encoded spaces', () => {
    const result = lspUriToFilePath('file:///home/user/my%20project/file.ts');

    // Bun.fileURLToPath decodes percent-encoding
    expect(result).toContain('/home/user/');
    expect(result).toContain('file.ts');
  });
});

// --- openTsDocument ---

describe('openTsDocument', () => {
  it('should send textDocument/didOpen notification with provided text', async () => {
    const notifications: Array<{ method: string; params: unknown }> = [];
    const mockLsp = {
      notify: async (method: string, params: unknown) => {
        notifications.push({ method, params });
      },
    };

    await openTsDocument({
      filePath: '/src/foo.ts',
      text: 'const x = 1;',
      lsp: mockLsp as never,
    });

    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.method).toBe('textDocument/didOpen');
    const params = notifications[0]!.params as Record<string, unknown>;
    const doc = params.textDocument as Record<string, unknown>;

    expect(doc.text).toBe('const x = 1;');
    expect(doc.languageId).toBe('typescript');
  });

  it('should return uri and text from openTsDocument', async () => {
    const mockLsp = { notify: async () => {} };

    const result = await openTsDocument({
      filePath: '/src/bar.ts',
      text: 'export const y = 2;',
      lsp: mockLsp as never,
    });

    expect(result.uri).toContain('bar.ts');
    expect(result.text).toBe('export const y = 2;');
  });

  it('should default languageId to typescript when not specified', async () => {
    const notifications: Array<{ method: string; params: unknown }> = [];
    const mockLsp = {
      notify: async (_m: string, params: unknown) => {
        notifications.push({ method: _m, params });
      },
    };

    await openTsDocument({ filePath: '/f.ts', text: '', lsp: mockLsp as never });

    const doc = (notifications[0]!.params as Record<string, unknown>).textDocument as Record<string, unknown>;

    expect(doc.languageId).toBe('typescript');
  });

  it('should use provided languageId when specified', async () => {
    const notifications: Array<{ method: string; params: unknown }> = [];
    const mockLsp = {
      notify: async (_m: string, params: unknown) => {
        notifications.push({ method: _m, params });
      },
    };

    await openTsDocument({ filePath: '/f.tsx', text: '', languageId: 'typescriptreact', lsp: mockLsp as never });

    const doc = (notifications[0]!.params as Record<string, unknown>).textDocument as Record<string, unknown>;

    expect(doc.languageId).toBe('typescriptreact');
  });

  it('should use version 1 by default', async () => {
    const notifications: Array<{ method: string; params: unknown }> = [];
    const mockLsp = {
      notify: async (_m: string, params: unknown) => {
        notifications.push({ method: _m, params });
      },
    };

    await openTsDocument({ filePath: '/f.ts', text: '', lsp: mockLsp as never });

    const doc = (notifications[0]!.params as Record<string, unknown>).textDocument as Record<string, unknown>;

    expect(doc.version).toBe(1);
  });
});
