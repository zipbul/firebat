import { describe, it, expect } from 'bun:test';

import { countOxcSize } from './oxc-size-count';
import { parseSource } from './parse-source';

const programOf = (src: string) => parseSource('test.ts', src).program;

describe('countOxcSize', () => {
  it('returns > 0 for a real AST program node', () => {
    const program = programOf('const x = 1;');

    expect(countOxcSize(program)).toBeGreaterThan(0);
  });

  it('counts more nodes for more complex source', () => {
    const simple = countOxcSize(programOf('const x = 1;'));
    const complex = countOxcSize(programOf('function f() { if (true) { for (let i=0;i<10;i++) { g(i); } } }'));

    expect(complex).toBeGreaterThan(simple);
  });
});
