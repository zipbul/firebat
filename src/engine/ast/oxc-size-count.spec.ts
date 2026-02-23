import { describe, it, expect } from 'bun:test';

import { parseSource } from './parse-source';
import { countOxcSize } from './oxc-size-count';

const programOf = (src: string) => parseSource('test.ts', src).program;

describe('countOxcSize', () => {
  it('returns 0 for a plain number value (not an OXC node)', () => {
    expect(countOxcSize(42 as never)).toBe(0);
  });

  it('returns 0 for null', () => {
    expect(countOxcSize(null as never)).toBe(0);
  });

  it('returns > 0 for a real AST program node', () => {
    const program = programOf('const x = 1;');
    expect(countOxcSize(program as never)).toBeGreaterThan(0);
  });

  it('counts more nodes for more complex source', () => {
    const simple = countOxcSize(programOf('const x = 1;') as never);
    const complex = countOxcSize(
      programOf('function f() { if (true) { for (let i=0;i<10;i++) { g(i); } } }') as never,
    );
    expect(complex).toBeGreaterThan(simple);
  });

  it('handles an array of nodes', () => {
    const program = programOf('const x = 1; const y = 2;');
    // program.body is an array of statements
    const body = (program as { body: unknown }).body;
    expect(Array.isArray(body)).toBe(true);
    const size = countOxcSize(body as never);
    expect(size).toBeGreaterThan(0);
  });
});
