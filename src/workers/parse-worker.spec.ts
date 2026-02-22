import { describe, it, expect } from 'bun:test';
import { __testing__ } from './parse-worker';

const { extractFilePath, extractRequestId, toCloneableError } = __testing__;

describe('extractFilePath', () => {
  it('should return null for null input', () => {
    expect(extractFilePath(null)).toBeNull();
  });

  it('should return null for non-object input', () => {
    expect(extractFilePath('string')).toBeNull();
    expect(extractFilePath(42)).toBeNull();
  });

  it('should return null when filePath is missing', () => {
    expect(extractFilePath({})).toBeNull();
  });

  it('should return null when filePath is not a string', () => {
    expect(extractFilePath({ filePath: 123 })).toBeNull();
  });

  it('should return null when filePath is empty/whitespace', () => {
    expect(extractFilePath({ filePath: '' })).toBeNull();
    expect(extractFilePath({ filePath: '   ' })).toBeNull();
  });

  it('should return filePath when valid string', () => {
    expect(extractFilePath({ filePath: '/src/a.ts' })).toBe('/src/a.ts');
  });
});

describe('extractRequestId', () => {
  it('should return 0 for null input', () => {
    expect(extractRequestId(null)).toBe(0);
  });

  it('should return 0 when requestId key is absent', () => {
    expect(extractRequestId({})).toBe(0);
  });

  it('should return 0 when requestId is not a number', () => {
    expect(extractRequestId({ requestId: 'abc' })).toBe(0);
  });

  it('should return 0 when requestId is Infinity', () => {
    expect(extractRequestId({ requestId: Infinity })).toBe(0);
  });

  it('should return 0 when requestId is less than 1', () => {
    expect(extractRequestId({ requestId: 0 })).toBe(0);
    expect(extractRequestId({ requestId: -5 })).toBe(0);
  });

  it('should return floored value when requestId is valid', () => {
    expect(extractRequestId({ requestId: 3 })).toBe(3);
    expect(extractRequestId({ requestId: 7.9 })).toBe(7);
  });
});

describe('toCloneableError', () => {
  it('should return message for Error instance', () => {
    expect(toCloneableError(new Error('oops'))).toBe('oops');
  });

  it('should return message from object with message property', () => {
    expect(toCloneableError({ message: 'custom error' })).toBe('custom error');
  });

  it('should return String(value) for primitives', () => {
    expect(toCloneableError('raw string')).toBe('raw string');
    expect(toCloneableError(42)).toBe('42');
  });

  it('should return String(value) for null', () => {
    expect(toCloneableError(null)).toBe('null');
  });
});
