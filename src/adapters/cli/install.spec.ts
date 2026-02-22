import { describe, it, expect } from 'bun:test';

import { __testing__, runInstall, runUpdate } from './install';

const { sha256Hex, isPlainObject, toJsonValue, sortJsonValue, jsonText, parseYesFlag } = __testing__;

describe('sha256Hex', () => {
  it('should return a 64-char hex string', async () => {
    const hash = await sha256Hex('hello');

    expect(typeof hash).toBe('string');
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
  });

  it('should return consistent results', async () => {
    const h1 = await sha256Hex('test');
    const h2 = await sha256Hex('test');

    expect(h1).toBe(h2);
  });

  it('should return different hashes for different inputs', async () => {
    const h1 = await sha256Hex('hello');
    const h2 = await sha256Hex('world');

    expect(h1).not.toBe(h2);
  });
});

describe('isPlainObject', () => {
  it('should return true for plain objects', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
  });

  it('should return false for null, arrays, primitives', () => {
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject('string')).toBe(false);
    expect(isPlainObject(42)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });
});

describe('toJsonValue', () => {
  it('should pass through primitives', () => {
    expect(toJsonValue(null)).toBeNull();
    expect(toJsonValue('str')).toBe('str');
    expect(toJsonValue(42)).toBe(42);
    expect(toJsonValue(true)).toBe(true);
  });

  it('should convert arrays recursively', () => {
    expect(toJsonValue([1, 'two', null])).toEqual([1, 'two', null]);
  });

  it('should convert objects recursively', () => {
    expect(toJsonValue({ a: 1, b: [2, 3] })).toEqual({ a: 1, b: [2, 3] });
  });

  it('should throw for undefined', () => {
    expect(() => toJsonValue(undefined)).toThrow('Invalid JSON value');
  });

  it('should throw for non-JSON types (e.g. function)', () => {
    expect(() => toJsonValue(() => {})).toThrow('Invalid JSON value');
  });
});

describe('sortJsonValue', () => {
  it('should sort object keys alphabetically', () => {
    const result = sortJsonValue({ z: 1, a: 2, m: 3 }) as Record<string, number>;
    const keys = Object.keys(result);

    expect(keys).toEqual(['a', 'm', 'z']);
  });

  it('should recursively sort nested objects', () => {
    const result = sortJsonValue({ b: { z: 1, a: 2 }, a: 0 }) as Record<string, unknown>;

    expect(Object.keys(result)).toEqual(['a', 'b']);
    expect(Object.keys(result['b'] as Record<string, number>)).toEqual(['a', 'z']);
  });

  it('should preserve arrays order', () => {
    const result = sortJsonValue([3, 1, 2]);

    expect(result).toEqual([3, 1, 2]);
  });

  it('should handle null', () => {
    expect(sortJsonValue(null)).toBeNull();
  });

  it('should handle primitives unchanged', () => {
    expect(sortJsonValue('hello')).toBe('hello');
    expect(sortJsonValue(42)).toBe(42);
    expect(sortJsonValue(false)).toBe(false);
  });
});

describe('jsonText', () => {
  it('should return pretty-printed JSON with trailing newline', () => {
    const result = jsonText({ b: 2, a: 1 });

    expect(result.endsWith('\n')).toBe(true);
    // Keys sorted
    expect(result.indexOf('"a"')).toBeLessThan(result.indexOf('"b"'));
  });
});

describe('parseYesFlag', () => {
  it('should return yes:false, help:false for empty argv', () => {
    expect(parseYesFlag([])).toEqual({ yes: false, help: false });
  });

  it('should return yes:true for -y flag', () => {
    expect(parseYesFlag(['-y'])).toEqual({ yes: true, help: false });
  });

  it('should return yes:true for --yes flag', () => {
    expect(parseYesFlag(['--yes'])).toEqual({ yes: true, help: false });
  });

  it('should return help:true for -h flag', () => {
    expect(parseYesFlag(['-h'])).toEqual({ yes: false, help: true });
  });

  it('should return help:true for --help flag', () => {
    expect(parseYesFlag(['--help'])).toEqual({ yes: false, help: true });
  });

  it('should throw for unknown flags', () => {
    expect(() => parseYesFlag(['--unknown'])).toThrow('Unknown option');
  });

  it('should handle combined flags', () => {
    expect(parseYesFlag(['-y', '--help'])).toEqual({ yes: true, help: true });
  });
});

describe('runInstall', () => {
  it('should be a function', () => {
    expect(typeof runInstall).toBe('function');
  });
});

describe('runUpdate', () => {
  it('should be a function', () => {
    expect(typeof runUpdate).toBe('function');
  });
});
