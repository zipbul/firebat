import { describe, it, expect } from 'bun:test';

import { EdgeType } from './cfg-types';

describe('EdgeType', () => {
  it('has correct numeric values', () => {
    expect(EdgeType.Normal).toBe(0);
    expect(EdgeType.True).toBe(1);
    expect(EdgeType.False).toBe(2);
    expect(EdgeType.Exception).toBe(3);
  });

  it('is reversible (numeric → name)', () => {
    expect(EdgeType[0]).toBe('Normal');
    expect(EdgeType[1]).toBe('True');
    expect(EdgeType[2]).toBe('False');
    expect(EdgeType[3]).toBe('Exception');
  });
});
