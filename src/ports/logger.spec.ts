import { describe, it, expect } from 'bun:test';

import { createNoopLogger } from './logger';

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
