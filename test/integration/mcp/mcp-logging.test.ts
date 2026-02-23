import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test';

import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

import { createInMemoryMcpContext, type InMemoryMcpContext } from './helpers/inmemory-server';
import { callToolSafe } from './helpers/mcp-client';
import { createNoopLogger } from '../../../src/test-api';
// __testing__ is exported after implementation; before it, accessing it causes RED.
import { __testing__McpServer as __testing__ } from '../../../src/test-api';

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeMockServer = () => {
  const received: Array<{ level: string; data: unknown }> = [];
  const sendLoggingMessage = mock(async (params: { level: string; data: unknown }) => {
    received.push(params);
  });
  const server = { sendLoggingMessage } as any;

  return { received, server };
};

// ── Unit-style: createMcpLogger level mapping (via __testing__) ───────────────

describe('createMcpLogger', () => {
  it('should forward info log as MCP level info when logger.info is called', () => {
    // Arrange
    const { received, server } = makeMockServer();
    const logger = __testing__.createMcpLogger(server, createNoopLogger('trace'));

    // Act
    logger.info('test message');

    // Assert
    expect(received.length).toBeGreaterThan(0);
    expect(received[0]?.level).toBe('info');
  });

  it('should forward warn log as MCP level warning when logger.warn is called', () => {
    // Arrange
    const { received, server } = makeMockServer();
    const logger = __testing__.createMcpLogger(server, createNoopLogger('trace'));

    // Act
    logger.warn('warn message');

    // Assert
    expect(received[0]?.level).toBe('warning');
  });

  it('should forward error log as MCP level error when logger.error is called', () => {
    // Arrange
    const { received, server } = makeMockServer();
    const logger = __testing__.createMcpLogger(server, createNoopLogger('trace'));

    // Act
    logger.error('error message');

    // Assert
    expect(received[0]?.level).toBe('error');
  });

  it('should forward debug log as MCP level debug when logger.debug is called', () => {
    // Arrange
    const { received, server } = makeMockServer();
    const logger = __testing__.createMcpLogger(server, createNoopLogger('trace'));

    // Act
    logger.debug('debug message');

    // Assert
    expect(received[0]?.level).toBe('debug');
  });

  it('should forward trace log as MCP level debug when logger.trace is called', () => {
    // Arrange — trace is downgraded to 'debug' since MCP has no trace level
    const { received, server } = makeMockServer();
    const logger = __testing__.createMcpLogger(server, createNoopLogger('trace'));

    // Act
    logger.trace('trace message');

    // Assert
    expect(received[0]?.level).toBe('debug');
  });

  it('should not propagate rejection to caller when sendLoggingMessage rejects', () => {
    // Arrange
    const rejectingServer = {
      sendLoggingMessage: mock(async () => {
        throw new Error('send failed');
      }),
    } as any;
    const logger = __testing__.createMcpLogger(rejectingServer, createNoopLogger('trace'));

    // Act & Assert — must not throw synchronously
    expect(() => logger.info('will fail silently')).not.toThrow();
  });

  it('should call sendLoggingMessage when message is an empty string', () => {
    // Arrange
    const { received, server } = makeMockServer();
    const logger = __testing__.createMcpLogger(server, createNoopLogger('trace'));

    // Act
    logger.info('');

    // Assert
    expect(received.length).toBeGreaterThan(0);
  });
});

// ── Integration: MCP logging notifications from scan ─────────────────────────

describe('scan MCP logging notifications', () => {
  let ctx: InMemoryMcpContext;

  beforeAll(async () => {
    ctx = await createInMemoryMcpContext();
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('should receive at least one MCP logging notification when scan is called', async () => {
    // Arrange
    const received: unknown[] = [];

    ctx.client.setNotificationHandler(LoggingMessageNotificationSchema, notification => {
      received.push(notification);
    });

    // Act
    await callToolSafe(ctx.client, 'scan', {
      targets: [],
      detectors: ['noop'],
    });

    // Assert
    expect(received.length).toBeGreaterThan(0);
  }, 60_000);
});
