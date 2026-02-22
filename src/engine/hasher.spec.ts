import { describe, expect, it } from 'bun:test';

import { hashString, initHasher } from './hasher';

describe('initHasher', () => {
  it('should resolve without error', async () => {
    // Arrange & Act & Assert
    await expect(initHasher()).resolves.toBeUndefined();
  });
});

describe('hashString', () => {
  it('should return a 16-character lowercase hex string', () => {
    // Arrange & Act
    const result = hashString('hello');

    // Assert
    expect(result).toHaveLength(16);
    expect(/^[0-9a-f]{16}$/.test(result)).toBe(true);
  });

  it('should return consistent output for the same input', () => {
    // Arrange & Act
    const first = hashString('firebat');
    const second = hashString('firebat');

    // Assert
    expect(first).toBe(second);
  });

  it('should return different hashes for different inputs', () => {
    // Arrange & Act
    const a = hashString('hello');
    const b = hashString('world');

    // Assert
    expect(a).not.toBe(b);
  });

  it('should handle an empty string without throwing', () => {
    // Arrange & Act & Assert
    expect(() => hashString('')).not.toThrow();
    expect(hashString('')).toHaveLength(16);
  });
});
