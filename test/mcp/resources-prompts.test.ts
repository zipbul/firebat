import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

import { createMcpTestContext, callTool, type McpTestContext } from './helpers/mcp-client';

let ctx: McpTestContext;

interface ResourceContentText {
  readonly text: string;
}

interface ResourceContentBlob {
  readonly blob: string;
}

type ResourceContent = ResourceContentText | ResourceContentBlob;

interface PromptMessage {
  readonly role: string;
  readonly content: unknown;
}

const extractResourceText = (content: ResourceContent | undefined): string => {
  if (!content) {
    return '';
  }

  if ('text' in content) {
    return content.text;
  }

  return 'blob' in content ? content.blob : '';
};

const assertMessagesHaveContent = (messages: ReadonlyArray<PromptMessage>): void => {
  messages.forEach(message => {
    expect(message.role).toBeDefined();
    expect(message.content).toBeDefined();
  });
};

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

    const text = extractResourceText(result.contents[0] as ResourceContent | undefined);

    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  }, 120_000);

  test('should return valid JSON or text in report contents', async () => {
    // Act
    const result = await ctx.client.readResource({ uri: 'report://last' });
    // Assert
    const text = extractResourceText(result.contents[0] as ResourceContent | undefined);

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
    assertMessagesHaveContent(result.messages as ReadonlyArray<PromptMessage>);
  }, 30_000);

  test('should handle repeated calls', async () => {
    // Act & Assert
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        ctx.client.getPrompt({
          name: 'review',
          arguments: { reportJson: JSON.stringify({ meta: {}, analyses: {} }) },
        }),
      ),
    );

    results.forEach(result => {
      expect(result.messages.length).toBeGreaterThan(0);
    });
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
    assertMessagesHaveContent(result.messages as ReadonlyArray<PromptMessage>);
  }, 30_000);

  test('should handle repeated calls', async () => {
    // Act & Assert
    const results = await Promise.all(Array.from({ length: 3 }, () => ctx.client.getPrompt({ name: 'workflow' })));

    results.forEach(result => {
      expect(result.messages.length).toBeGreaterThan(0);
    });
  }, 60_000);
});

// -------------------------------------------------------------------------
// Error handling for non-existent resources & prompts
// -------------------------------------------------------------------------

describe('error handling', () => {
  test('should fail gracefully for non-existent resource', async () => {
    // Act & Assert
    await expect(ctx.client.readResource({ uri: 'report://nonexistent' })).rejects.toBeDefined();
  }, 30_000);

  test('should fail gracefully for non-existent prompt', async () => {
    // Act & Assert
    await expect(ctx.client.getPrompt({ name: 'nonexistent-prompt' })).rejects.toBeDefined();
  }, 30_000);
});
