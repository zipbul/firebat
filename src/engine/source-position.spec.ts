import { describe, expect, it } from 'bun:test';

import { getLineColumn } from './source-position';

describe('getLineColumn', () => {
  it('should return line 1, column 0 for offset 0 with no newlines', () => {
    // Arrange & Act
    const result = getLineColumn('hello', 0);

    // Assert
    expect(result).toEqual({ line: 1, column: 0 });
  });

  it('should return correct column when no newlines precede the offset', () => {
    // Arrange & Act
    const result = getLineColumn('hello world', 6);

    // Assert
    expect(result).toEqual({ line: 1, column: 6 });
  });

  it('should increment line when a newline precedes the offset', () => {
    // Arrange: "ab\ncde", offset=4 → 'c'
    const result = getLineColumn('ab\ncde', 4);

    // Assert
    expect(result).toEqual({ line: 2, column: 1 });
  });

  it('should track multiple newlines and compute correct line and column', () => {
    // Arrange: "a\nb\nc", offset=4 → 'c' (line 3, column 0)
    const result = getLineColumn('a\nb\nc', 4);

    // Assert
    expect(result).toEqual({ line: 3, column: 0 });
  });

  it('should return column 0 when offset is immediately after a newline', () => {
    // Arrange: "\nX", offset=1 → 'X'
    const result = getLineColumn('\nX', 1);

    // Assert
    expect(result).toEqual({ line: 2, column: 0 });
  });

  it('should return correct column when offset is several characters after the newline', () => {
    // Arrange: "\nhello", offset=3 → 'l' (line 2, column 2)
    const result = getLineColumn('\nhello', 3);

    // Assert
    expect(result).toEqual({ line: 2, column: 2 });
  });

  it('should return line 1, column 0 when source is empty and offset is 0', () => {
    // Arrange & Act
    const result = getLineColumn('', 0);

    // Assert
    expect(result).toEqual({ line: 1, column: 0 });
  });
});
