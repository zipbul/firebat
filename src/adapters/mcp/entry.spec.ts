import { mock, afterAll, describe, it, expect } from 'bun:test';
import * as nodePath from 'node:path';

const __origServer = { ...require(nodePath.resolve(import.meta.dir, './server.ts')) };
const __origLogging = { ...require(nodePath.resolve(import.meta.dir, '../../shared/logger.ts')) };
const __origRootResolver = { ...require(nodePath.resolve(import.meta.dir, '../../shared/root-resolver.ts')) };

const mockRunMcpServer = mock(async () => undefined);

mock.module(nodePath.resolve(import.meta.dir, './server.ts'), () => ({
  runMcpServer: mockRunMcpServer,
}));

mock.module(nodePath.resolve(import.meta.dir, '../../shared/logger.ts'), () => ({
  appendFirebatLog: mock(async () => undefined),
}));

mock.module(nodePath.resolve(import.meta.dir, '../../shared/root-resolver.ts'), () => ({
  resolveFirebatRootFromCwd: mock(async () => ({ rootAbs: '/project' })),
}));

import { runMcp } from './entry';

describe('runMcp', () => {
  it('should be a function', () => {
    expect(typeof runMcp).toBe('function');
  });

  it('should call runMcpServer and resolve', async () => {
    mockRunMcpServer.mockResolvedValue(undefined as never);

    await expect(runMcp()).resolves.toBeUndefined();
  });

  it('should install process error handlers before running', async () => {
    const listenersBefore = process.listenerCount('uncaughtException');

    mockRunMcpServer.mockResolvedValue(undefined as never);
    await runMcp();

    // installMcpErrorHandlers adds uncaughtException + unhandledRejection handlers
    expect(process.listenerCount('uncaughtException')).toBeGreaterThan(listenersBefore);
  });
});

afterAll(() => {
  mock.restore();
  mock.module(nodePath.resolve(import.meta.dir, './server.ts'), () => __origServer);
  mock.module(nodePath.resolve(import.meta.dir, '../../shared/logger.ts'), () => __origLogging);
  mock.module(nodePath.resolve(import.meta.dir, '../../shared/root-resolver.ts'), () => __origRootResolver);
});
