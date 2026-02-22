import { describe, it, expect, spyOn, beforeEach, afterEach } from 'bun:test';

import { createPrettyConsoleLogger } from './pretty-console-logger';

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
