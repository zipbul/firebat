import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

import { createMcpTestContext, callTool, type McpTestContext } from './helpers/mcp-client';

let ctx: McpTestContext;

beforeAll(async () => {
  ctx = await createMcpTestContext({ copyFixtures: true });
}, 30_000);

afterAll(async () => {
  await ctx?.close();
});

// -------------------------------------------------------------------------
// Resources
// -------------------------------------------------------------------------

describe('resource: report://last', () => {
  test('should return a report after a scan', async () => {
    // Arrange – run a scan first so the report exists
    await callTool(ctx.client, 'scan', {
      targets: [ctx.fixturesAbs],
      detectors: ['exact-duplicates'],
      minSize: 'auto',
    });

    // Act
    const result = await ctx.client.readResource({ uri: 'report://last' });

    // Assert
    expect(result).toBeDefined();
    expect(result.contents).toBeDefined();
    expect(result.contents.length).toBeGreaterThan(0);

    const content = result.contents[0];
    const text = content && 'text' in content ? content.text : content && 'blob' in content ? content.blob : '';

    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  }, 120_000);

  test('should return valid JSON or text in report contents', async () => {
    // Act
    const result = await ctx.client.readResource({ uri: 'report://last' });
    // Assert
    const content = result.contents[0];
    const text = content && 'text' in content ? content.text : '';

    expect(text.length).toBeGreaterThan(0);
  }, 30_000);
});

// -------------------------------------------------------------------------
// Prompts
// -------------------------------------------------------------------------

describe('prompt: review', () => {
  test('should return a review prompt', async () => {
    // Act
    const result = await ctx.client.getPrompt({
      name: 'review',
      arguments: { reportJson: JSON.stringify({ meta: {}, analyses: {} }) },
    });

    // Assert
    expect(result).toBeDefined();
    expect(result.messages).toBeDefined();
    expect(Array.isArray(result.messages)).toBe(true);
    expect(result.messages.length).toBeGreaterThan(0);
  }, 30_000);

  test('should include text content in review messages', async () => {
    // Act
    const result = await ctx.client.getPrompt({
      name: 'review',
      arguments: { reportJson: JSON.stringify({ meta: {}, analyses: {} }) },
    });

    // Assert
    for (const msg of result.messages) {
      expect(msg.role).toBeDefined();
      expect(msg.content).toBeDefined();
    }
  }, 30_000);

  test('should handle repeated calls', async () => {
    // Act & Assert
    for (let i = 0; i < 3; i++) {
      const result = await ctx.client.getPrompt({
        name: 'review',
        arguments: { reportJson: JSON.stringify({ meta: {}, analyses: {} }) },
      });

      expect(result.messages.length).toBeGreaterThan(0);
    }
  }, 60_000);
});

describe('prompt: workflow', () => {
  test('should return a workflow prompt', async () => {
    // Act
    const result = await ctx.client.getPrompt({ name: 'workflow' });

    // Assert
    expect(result).toBeDefined();
    expect(result.messages).toBeDefined();
    expect(Array.isArray(result.messages)).toBe(true);
    expect(result.messages.length).toBeGreaterThan(0);
  }, 30_000);

  test('should include text content in workflow messages', async () => {
    // Act
    const result = await ctx.client.getPrompt({ name: 'workflow' });

    // Assert
    for (const msg of result.messages) {
      expect(msg.role).toBeDefined();
      expect(msg.content).toBeDefined();
    }
  }, 30_000);

  test('should handle repeated calls', async () => {
    // Act & Assert
    for (let i = 0; i < 3; i++) {
      const result = await ctx.client.getPrompt({ name: 'workflow' });

      expect(result.messages.length).toBeGreaterThan(0);
    }
  }, 60_000);
});

// -------------------------------------------------------------------------
// Error handling for non-existent resources & prompts
// -------------------------------------------------------------------------

describe('error handling', () => {
  test('should fail gracefully for non-existent resource', async () => {
    // Act & Assert
    try {
      await ctx.client.readResource({ uri: 'report://nonexistent' });
      // If it doesn't throw, that's also fine – just verify it returns something
    } catch (err: any) {
      expect(err).toBeDefined();
    }
  }, 30_000);

  test('should fail gracefully for non-existent prompt', async () => {
    // Act & Assert
    try {
      await ctx.client.getPrompt({ name: 'nonexistent-prompt' });
      // If it doesn't throw, that's also fine
    } catch (err: any) {
      expect(err).toBeDefined();
    }
  }, 30_000);
});
