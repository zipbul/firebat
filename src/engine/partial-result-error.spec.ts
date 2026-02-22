import { describe, expect, it } from 'bun:test';

import { PartialResultError } from './partial-result-error';

describe('PartialResultError', () => {
  it('should store the message passed to the constructor', () => {
    // Arrange & Act
    const err = new PartialResultError('scan failed', [1, 2]);

    // Assert
    expect(err.message).toBe('scan failed');
  });

  it('should store the partial array passed to the constructor', () => {
    // Arrange
    const partial = [{ file: 'a.ts', line: 1 }];

    // Act
    const err = new PartialResultError('partial', partial);

    // Assert
    expect(err.partial).toBe(partial);
  });

  it('should be instanceof Error', () => {
    // Arrange & Act
    const err = new PartialResultError('test', []);

    // Assert
    expect(err instanceof Error).toBe(true);
  });

  it('should set name to PartialResultError', () => {
    // Arrange & Act
    const err = new PartialResultError('test', []);

    // Assert
    expect(err.name).toBe('PartialResultError');
  });

  it('should accept an empty partial array', () => {
    // Arrange & Act
    const err = new PartialResultError('nothing found', []);

    // Assert
    expect(err.partial).toHaveLength(0);
  });
});
