import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import { createInMemoryMcpContext, type InMemoryMcpContext } from './helpers/inmemory-server';
import { callToolSafe } from './helpers/mcp-client';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const asRecordOrThrow = (value: unknown, message: string): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error(message);
  }

  return value;
};

const asArrayOrEmpty = <T>(value: ReadonlyArray<T> | undefined): ReadonlyArray<T> => {
  if (Array.isArray(value)) {
    return value;
  }

  return [];
};

const parseJsonOrEmptyObject = (text: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(text);

    return asRecordOrThrow(parsed, 'Expected parsed JSON to be an object');
  } catch {
    return {};
  }
};

const requireTextResourceContent = (content: unknown): string => {
  const record = asRecordOrThrow(content, 'Expected resource content object');
  const text = record.text;

  if (typeof text !== 'string') {
    throw new Error('Expected resource content to have text');
  }

  return text;
};

const messageHasTextContent = (message: unknown): boolean => {
  if (!isRecord(message)) {
    return false;
  }

  const content = message.content;

  if (!isRecord(content)) {
    return false;
  }

  return typeof content.text === 'string';
};

describe('InMemory MCP strict (protocol / init)', () => {
  let ctx: InMemoryMcpContext;

  beforeAll(async () => {
    ctx = await createInMemoryMcpContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('initialize', () => {
    it('should receive server name, version, and capabilities after client connect', () => {
      const version = ctx.client.getServerVersion();
      const capabilities = ctx.client.getServerCapabilities();

      expect(version).toBeDefined();
      expect(version?.name).toBe('firebat');
      expect(version?.version).toBeDefined();
      expect(typeof version?.version).toBe('string');

      expect(capabilities).toBeDefined();
      expect(typeof capabilities).toBe('object');
    });
  });

  describe('tools/list', () => {
    it('should list all registered tools with name, description, inputSchema', async () => {
      const result = await ctx.client.listTools();
      const tools = asArrayOrEmpty(result.tools);

      expect(tools.length).toBeGreaterThanOrEqual(35);

      for (const tool of tools) {
        expect(tool.name).toBeDefined();
        expect(typeof tool.name).toBe('string');
        expect(tool.description !== undefined).toBe(true);
        expect(tool.inputSchema).toBeDefined();
        expect(typeof tool.inputSchema).toBe('object');
      }
    });
  });

  describe('resources/list', () => {
    it('should list expected resource URIs including report://last', async () => {
      const result = await ctx.client.listResources();
      const resources = asArrayOrEmpty(result.resources);
      const uris = resources.map(r => r.uri);

      expect(uris).toContain('report://last');
    });
  });

  describe('prompts/list', () => {
    it('should list expected prompts including review and workflow', async () => {
      const result = await ctx.client.listPrompts();
      const prompts = asArrayOrEmpty(result.prompts);
      const names = prompts.map(p => p.name);

      expect(names).toContain('review');
      expect(names).toContain('workflow');
    });
  });

  describe('Tool matrix (4.2)', () => {
    describe('scan', () => {
      it('should succeed with minimal args (default targets)', async () => {
        const { structured, isError } = await callToolSafe(ctx.client, 'scan', {});

        expect(isError).toBe(false);
        expect(structured).toBeDefined();
        expect(typeof structured).toBe('object');
      });

      it('should succeed with targets and detectors', async () => {
        const { structured, isError } = await callToolSafe(ctx.client, 'scan', {
          targets: [ctx.rootAbs],
          detectors: ['lint', 'format'],
        });

        expect(isError).toBe(false);
        expect(structured).toBeDefined();
        expect(typeof structured).toBe('object');
      });

      it('should return result when given invalid detector names (may filter or error)', async () => {
        const { structured, isError } = await callToolSafe(ctx.client, 'scan', {
          targets: [ctx.rootAbs],
          detectors: ['invalid-detector-name'],
        });

        expect(typeof isError).toBe('boolean');
        expect(structured).toBeDefined();
      });
    });

    describe('list_dir', () => {
      it('should succeed with relativePath and return entries', async () => {
        const { structured, isError } = await callToolSafe(ctx.client, 'list_dir', {
          relativePath: '.',
          root: ctx.rootAbs,
        });

        expect(isError).toBe(false);

        const record = asRecordOrThrow(structured, 'Expected list_dir structured result');

        expect(record.entries).toBeDefined();
        expect(Array.isArray(record.entries)).toBe(true);
      });

      it('should succeed with recursive true', async () => {
        const { structured, isError } = await callToolSafe(ctx.client, 'list_dir', {
          relativePath: '.',
          root: ctx.rootAbs,
          recursive: true,
        });

        expect(isError).toBe(false);

        const record = asRecordOrThrow(structured, 'Expected list_dir structured result');

        expect(Array.isArray(record.entries)).toBe(true);
      });
    });

    describe('memory (list_memories, read, write, delete)', () => {
      it('should list memories (empty or with keys)', async () => {
        const { structured, isError } = await callToolSafe(ctx.client, 'list_memories', { root: ctx.rootAbs });

        expect(isError).toBe(false);

        const record = asRecordOrThrow(structured, 'Expected list_memories structured result');

        expect(Array.isArray(record.memories)).toBe(true);
      });

      it('should write then read then delete', async () => {
        const key = `inmemory-strict-${Date.now()}`;
        const value = { foo: 'bar', n: 1 };
        const w = await callToolSafe(ctx.client, 'write_memory', { root: ctx.rootAbs, memoryKey: key, value });

        expect(w.isError).toBe(false);

        const r = await callToolSafe(ctx.client, 'read_memory', { root: ctx.rootAbs, memoryKey: key });

        expect(r.isError).toBe(false);
        expect(r.structured?.found).toBe(true);
        expect(r.structured?.value).toEqual(value);

        const d = await callToolSafe(ctx.client, 'delete_memory', { root: ctx.rootAbs, memoryKey: key });

        expect(d.isError).toBe(false);
        expect(d.structured?.ok).toBe(true);

        const r2 = await callToolSafe(ctx.client, 'read_memory', { root: ctx.rootAbs, memoryKey: key });
        const r2Record = asRecordOrThrow(r2.structured, 'Expected read_memory structured result');

        expect(r2Record.found).toBe(false);
      });

      it('should return found false for non-existent key', async () => {
        const { structured, isError } = await callToolSafe(ctx.client, 'read_memory', {
          root: ctx.rootAbs,
          memoryKey: 'non-existent-key-xyz',
        });

        expect(isError).toBe(false);

        const record = asRecordOrThrow(structured, 'Expected read_memory structured result');

        expect(record.found).toBe(false);
      });
    });

    describe('get_project_overview', () => {
      it('should return overview with indexed files and root', async () => {
        const { structured, isError } = await callToolSafe(ctx.client, 'get_project_overview', {
          root: ctx.rootAbs,
        });

        expect(isError).toBe(false);
        expect(structured).toBeDefined();
        expect(structured?.root).toBeDefined();
      });
    });

    describe('index_symbols and search_symbol_from_index', () => {
      it('should index then search', async () => {
        const idx = await callToolSafe(ctx.client, 'index_symbols', { root: ctx.rootAbs });

        expect(idx.isError).toBe(false);

        const search = await callToolSafe(ctx.client, 'search_symbol_from_index', {
          root: ctx.rootAbs,
          query: 'create',
          limit: 5,
        });

        expect(search.isError).toBe(false);

        const record = asRecordOrThrow(search.structured, 'Expected search_symbol_from_index structured result');

        expect(Array.isArray(record.matches)).toBe(true);
      });
    });

    describe('get_hover (LSP)', () => {
      it('should return hover or error for existing file and line', async () => {
        const pkgPath = `${ctx.rootAbs}/package.json`;
        const { structured, isError } = await callToolSafe(ctx.client, 'get_hover', {
          root: ctx.rootAbs,
          filePath: pkgPath,
          line: 1,
        });

        expect(isError).toBe(false);
        expect(structured).toBeDefined();
      });
    });

    describe('list_dir edge – root', () => {
      it('should use default root when root omitted', async () => {
        const { structured, isError } = await callToolSafe(ctx.client, 'list_dir', { relativePath: '.' });

        expect(isError).toBe(false);

        const record = asRecordOrThrow(structured, 'Expected list_dir structured result');

        expect(record.entries).toBeDefined();
      });
    });
  });

  describe('Resources (4.3)', () => {
    it('should read report://last (empty or with report after scan)', async () => {
      const result = await ctx.client.readResource({ uri: 'report://last' });
      const contents = asArrayOrEmpty(result.contents);
      const content = contents[0];

      expect(content).toBeDefined();

      const text = requireTextResourceContent(content);
      const data = parseJsonOrEmptyObject(text);

      expect(data).toBeDefined();
    });

    it('should have report with meta after one scan', async () => {
      await callToolSafe(ctx.client, 'scan', { targets: [ctx.rootAbs] });

      const result = await ctx.client.readResource({ uri: 'report://last' });
      const contents = asArrayOrEmpty(result.contents);
      const content = contents[0];

      expect(content).toBeDefined();

      const text = requireTextResourceContent(content);
      const data = parseJsonOrEmptyObject(text);

      expect(typeof data).toBe('object');
      expect(data.meta).toBeDefined();
    });
  });

  describe('Prompts (4.4)', () => {
    it('should get review prompt with reportJson', async () => {
      const result = await ctx.client.getPrompt({ name: 'review', arguments: { reportJson: '{}' } });
      const messages = asArrayOrEmpty(result.messages);

      expect(messages.length).toBeGreaterThan(0);
      expect(messages.some(messageHasTextContent)).toBe(true);
    });

    it('should get workflow prompt with no args', async () => {
      const result = await ctx.client.getPrompt({ name: 'workflow' });
      const messages = asArrayOrEmpty(result.messages);

      expect(messages.length).toBeGreaterThan(0);
    });
  });

  describe('Concurrency and lifecycle (4.5, 4.6)', () => {
    it('should handle concurrent listTools calls', async () => {
      const promises = Array.from({ length: 10 }, () => ctx.client.listTools());
      const results = await Promise.all(promises);

      expect(results.length).toBe(10);

      for (const r of results) {
        expect(r.tools?.length).toBeGreaterThanOrEqual(35);
      }
    });

    it('should handle concurrent get_project_overview calls', async () => {
      const promises = Array.from({ length: 5 }, () => callToolSafe(ctx.client, 'get_project_overview', { root: ctx.rootAbs }));
      const results = await Promise.all(promises);

      expect(results.length).toBe(5);

      for (const r of results) {
        expect(r.isError).toBe(false);
        expect(r.structured?.root).toBeDefined();
      }
    });

    it('close should be idempotent (double close)', async () => {
      const c = await createInMemoryMcpContext();

      await c.close();
      await c.close();
    });
  });
});
