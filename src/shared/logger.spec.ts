import { afterAll, afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { appendFirebatLog, createNoopLogger, createPrettyConsoleLogger } from './logger';

// ── createNoopLogger ──────────────────────────────────────────────────────────

describe('createNoopLogger', () => {
  it('[HP] creates a logger with the specified level', () => {
    const logger = createNoopLogger('warn');
    expect(logger.level).toBe('warn');
  });

  it('[HP] defaults level to error when none specified', () => {
    const logger = createNoopLogger();
    expect(logger.level).toBe('error');
  });

  it('[HP] all log methods are callable without throwing', () => {
    const logger = createNoopLogger('debug');
    expect(() => logger.log('info', 'msg')).not.toThrow();
    expect(() => logger.error('err')).not.toThrow();
    expect(() => logger.warn('w')).not.toThrow();
    expect(() => logger.info('i')).not.toThrow();
    expect(() => logger.debug('d')).not.toThrow();
    expect(() => logger.trace('t')).not.toThrow();
  });

  it('[HP] log methods return undefined (noop)', () => {
    const logger = createNoopLogger();
    expect(logger.log('error', 'x')).toBeUndefined();
    expect(logger.error('x')).toBeUndefined();
    expect(logger.info('x')).toBeUndefined();
  });

  it('[HP] noop logger accepts optional fields and error args', () => {
    const logger = createNoopLogger();
    expect(() => logger.log('error', 'msg', { key: 'val' }, new Error('test'))).not.toThrow();
  });
});

// ── appendFirebatLog ──────────────────────────────────────────────────────────

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'firebat-logging-test-'));

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('appendFirebatLog', () => {
  it('[HP] creates the log file and appends a message', async () => {
    const logRelPath = 'logs/test.log';
    await appendFirebatLog(tmpDir, logRelPath, 'hello log');
    const content = await fs.readFile(path.join(tmpDir, logRelPath), 'utf8');
    expect(content).toContain('hello log');
  });

  it('[HP] appended entry includes ISO timestamp bracket and newline', async () => {
    const logRelPath = 'logs/ts-test.log';
    await appendFirebatLog(tmpDir, logRelPath, 'message');
    const content = await fs.readFile(path.join(tmpDir, logRelPath), 'utf8');
    expect(content).toMatch(/\[\d{4}-\d{2}-\d{2}T/);
    expect(content).toEndWith('\n');
  });

  it('[HP] creates nested directories automatically', async () => {
    const deepRelPath = 'a/b/c/deep.log';
    await appendFirebatLog(tmpDir, deepRelPath, 'deep');
    const content = await fs.readFile(path.join(tmpDir, deepRelPath), 'utf8');
    expect(content).toContain('deep');
  });

  it('[HP] appending multiple times accumulates entries', async () => {
    const logRelPath = 'logs/multi.log';
    await appendFirebatLog(tmpDir, logRelPath, 'first');
    await appendFirebatLog(tmpDir, logRelPath, 'second');
    const content = await fs.readFile(path.join(tmpDir, logRelPath), 'utf8');
    expect(content).toContain('first');
    expect(content).toContain('second');
  });
});

// ── createPrettyConsoleLogger ─────────────────────────────────────────────────

describe('createPrettyConsoleLogger', () => {
  let consoleErrorSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('[HP] has the specified level', () => {
    const logger = createPrettyConsoleLogger({ level: 'warn', useColor: false });
    expect(logger.level).toBe('warn');
  });

  it('[HP] emits error messages when level=error', () => {
    const logger = createPrettyConsoleLogger({ level: 'error', useColor: false });
    logger.error('something bad');
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it('[HP] suppresses info messages when level=error', () => {
    const logger = createPrettyConsoleLogger({ level: 'error', useColor: false });
    logger.info('verbose message');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('[HP] emits all levels when level=trace', () => {
    const logger = createPrettyConsoleLogger({ level: 'trace', useColor: false });
    logger.error('e');
    logger.warn('w');
    logger.info('i');
    logger.debug('d');
    logger.trace('t');
    expect(consoleErrorSpy).toHaveBeenCalledTimes(5);
  });

  it('[HP] log() method routes to correct level', () => {
    const logger = createPrettyConsoleLogger({ level: 'debug', useColor: false });
    logger.log('debug', 'test message');
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const output = (consoleErrorSpy.mock.calls[0] as string[])[0];
    expect(output).toContain('test message');
    expect(output).toContain('DEBUG');
  });

  it('[HP] formats fields in output', () => {
    const logger = createPrettyConsoleLogger({ level: 'info', useColor: false });
    logger.info('with fields', { key: 'val', count: 42 });
    const output = (consoleErrorSpy.mock.calls[0] as string[])[0];
    expect(output).toContain('key=val');
    expect(output).toContain('count=42');
  });

  it('[HP] formats durationMs field specially', () => {
    const logger = createPrettyConsoleLogger({ level: 'info', useColor: false });
    logger.info('with duration', { durationMs: 500 });
    const output = (consoleErrorSpy.mock.calls[0] as string[])[0];
    expect(output).toContain('500ms');
  });

  it('[HP] formats durationMs ≥ 1000ms as seconds', () => {
    const logger = createPrettyConsoleLogger({ level: 'info', useColor: false });
    logger.info('with duration', { durationMs: 2000 });
    const output = (consoleErrorSpy.mock.calls[0] as string[])[0];
    expect(output).toContain('2.00s');
  });

  it('[HP] includeStack appends error stack trace', () => {
    const logger = createPrettyConsoleLogger({ level: 'error', useColor: false, includeStack: true });
    const err = new Error('stack test');
    logger.error('failed', {}, err);
    const output = (consoleErrorSpy.mock.calls[0] as string[])[0];
    expect(output).toContain('Error: stack test');
  });

  it('[HP] skips undefined fields', () => {
    const logger = createPrettyConsoleLogger({ level: 'info', useColor: false });
    logger.info('msg', { present: 'yes', absent: undefined });
    const output = (consoleErrorSpy.mock.calls[0] as string[])[0];
    expect(output).toContain('present=yes');
    expect(output).not.toContain('absent');
  });
});
