import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import { createInMemoryMcpContext, type InMemoryMcpContext } from './helpers/inmemory-server';
import { callToolSafe } from './helpers/mcp-client';

const asArrayOrEmpty = <T>(value: ReadonlyArray<T> | undefined): ReadonlyArray<T> => {
  if (Array.isArray(value)) {
    return value;
  }

  return [];
};

describe('InMemory MCP strict (scan-only)', () => {
  let ctx: InMemoryMcpContext;

  beforeAll(async () => {
    ctx = await createInMemoryMcpContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe('initialize', () => {
    it('should receive server name, version, and capabilities when client connects', () => {
      // Arrange

      // Act
      const version = ctx.client.getServerVersion();
      const capabilities = ctx.client.getServerCapabilities();

      // Assert
      expect(version).toBeDefined();
      expect(version?.name).toBe('firebat');
      expect(version?.version).toBeDefined();
      expect(typeof version?.version).toBe('string');

      expect(capabilities).toBeDefined();
      expect(typeof capabilities).toBe('object');
    });
  });

  describe('tools/list', () => {
    it('should list only scan tool when tools are requested', async () => {
      // Arrange

      // Act
      const result = await ctx.client.listTools();
      const tools = asArrayOrEmpty(result.tools);

      // Assert
      expect(tools.length).toBe(1);
      expect(tools[0]?.name).toBe('scan');
      expect(tools[0]?.description !== undefined).toBe(true);
      expect(typeof tools[0]?.inputSchema).toBe('object');
    });
  });

  describe('resources/list', () => {
    it('should not expose resources capability when resources are requested', async () => {
      // Arrange

      // Act
      await expect(ctx.client.listResources()).rejects.toMatchObject({ code: -32601 });

      // Assert
    });
  });

  describe('prompts/list', () => {
    it('should not expose prompts capability when prompts are requested', async () => {
      // Arrange

      // Act
      await expect(ctx.client.listPrompts()).rejects.toMatchObject({ code: -32601 });

      // Assert
    });
  });

  describe('scan', () => {
    it('should succeed when called with minimal args (default targets)', async () => {
      const { structured, isError } = await callToolSafe(ctx.client, 'scan', {});

      expect(isError).toBe(false);
      expect(structured).toBeDefined();
      expect(typeof structured).toBe('object');
    });

    it('should succeed when called with targets and detectors', async () => {
      const { structured, isError } = await callToolSafe(ctx.client, 'scan', {
        targets: [ctx.rootAbs],
        detectors: ['lint', 'format'],
      });

      expect(isError).toBe(false);
      expect(structured).toBeDefined();
      expect(typeof structured).toBe('object');
    });

    it('should return a result when given invalid detector names (may filter or error)', async () => {
      // Arrange
      const { structured, isError } = await callToolSafe(ctx.client, 'scan', {
        targets: [ctx.rootAbs],
        detectors: ['invalid-detector-name'],
      });

      // Act
      // (tool call already performed above)

      // Assert
      expect(typeof isError).toBe('boolean');
      expect(structured).toBeDefined();
    });
  });
});
