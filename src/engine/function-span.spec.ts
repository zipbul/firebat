import { describe, expect, it } from 'bun:test';
import type { Node } from 'oxc-parser';

import { getFunctionSpan } from './function-span';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeNode = (start: number, end: number): Node =>
  ({ start, end }) as unknown as Node;

// ── getFunctionSpan ───────────────────────────────────────────────────────────

describe('getFunctionSpan', () => {
  it('should return correct start and end positions for a single-line source', () => {
    // Arrange: "function foo() {}" — start=9, end=12 → "foo"
    const source = 'function foo() {}';
    const node = makeNode(9, 12);

    // Act
    const span = getFunctionSpan(node, source);

    // Assert
    expect(span.start).toEqual({ line: 1, column: 9 });
    expect(span.end).toEqual({ line: 1, column: 12 });
  });

  it('should return correct line numbers for a multi-line source', () => {
    // Arrange: first line ends with \n, function on line 2
    const source = 'const x = 1;\nfunction foo() {}';
    // 'function' starts at index 13 (after the \n), 'f'=13
    const node = makeNode(13, 21); // "function"
    // Act
    const span = getFunctionSpan(node, source);

    // Assert
    expect(span.start.line).toBe(2);
    expect(span.start.column).toBe(0);
    expect(span.end.line).toBe(2);
  });

  it('should delegate to getLineColumn and produce a SourceSpan with start and end', () => {
    // Arrange
    const source = 'abc';
    const node = makeNode(0, 3);

    // Act
    const span = getFunctionSpan(node, source);

    // Assert
    expect(span).toHaveProperty('start');
    expect(span).toHaveProperty('end');
    expect(typeof span.start.line).toBe('number');
    expect(typeof span.start.column).toBe('number');
  });
});
