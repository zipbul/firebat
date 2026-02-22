import { describe, it, expect } from 'bun:test';

import { parseSource } from './parse-source';

describe('parseSource', () => {
  it('returns a ParsedFile with the given filePath and sourceText', () => {
    const result = parseSource('test.ts', 'const x = 1;');
    expect(result.filePath).toBe('test.ts');
    expect(result.sourceText).toBe('const x = 1;');
  });

  it('populates program from parsed AST', () => {
    const result = parseSource('test.ts', 'const x = 1;');
    expect(result.program).toBeDefined();
  });

  it('has no errors for valid source', () => {
    const result = parseSource('test.ts', 'function f() { return 42; }');
    expect(result.errors).toHaveLength(0);
  });

  it('reports errors for invalid source', () => {
    const result = parseSource('test.ts', 'const = ;');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('populates comments', () => {
    const result = parseSource('test.ts', '// hello\nconst x = 1;');
    expect(Array.isArray(result.comments)).toBe(true);
    expect(result.comments.length).toBeGreaterThan(0);
  });
});
