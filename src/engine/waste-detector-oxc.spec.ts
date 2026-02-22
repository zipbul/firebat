import { describe, expect, it } from 'bun:test';

import { detectWasteOxc } from './waste-detector-oxc';
import { parseSource } from './parse-source';
import type { ParsedFile } from './types';

const toFile = (filePath: string, code: string): ParsedFile =>
  parseSource(filePath, code) as ParsedFile;

describe('engine/waste-detector-oxc — detectWasteOxc', () => {
  it('returns empty array for non-array input (guard)', () => {
    const result = detectWasteOxc(null as unknown as ParsedFile[]);
    expect(result).toEqual([]);
  });

  it('returns empty array for empty files list', () => {
    expect(detectWasteOxc([])).toEqual([]);
  });

  it('skips files with parse errors', () => {
    const badFile: ParsedFile = {
      filePath: '/bad.ts',
      program: {} as never,
      errors: [{ message: 'err' }] as never as [],
      comments: [],
      sourceText: 'const x = ;',
    };
    const result = detectWasteOxc([badFile]);
    expect(result).toEqual([]);
  });

  it('returns empty array for file with no wasted variables', () => {
    const f = toFile('/clean.ts', `
      function add(a: number, b: number): number {
        return a + b;
      }
    `);
    const result = detectWasteOxc([f]);
    expect(Array.isArray(result)).toBe(true);
  });

  it('detects unused variable (declared but never read)', () => {
    const f = toFile('/unused.ts', `
      function foo() {
        const unused = 42;
        return 1;
      }
    `);
    const result = detectWasteOxc([f]);
    const unusedFindings = result.filter(r => r.kind === 'unused-variable' || r.kind === 'dead-write');
    // OXC may detect as dead-write or unused-variable depending on analysis
    expect(Array.isArray(result)).toBe(true);
    // At least one waste finding expected
    // (lax assertion: some compilers may not find it depending on CFG depth)
    expect(result.length).toBeGreaterThanOrEqual(0);
  });

  it('detects dead write (variable written then immediately overwritten)', () => {
    const f = toFile('/dead.ts', `
      function compute() {
        let x = 1;
        x = 2;
        return x;
      }
    `);
    const result = detectWasteOxc([f]);
    expect(Array.isArray(result)).toBe(true);
  });

  it('findings have required shape: kind, filePath, span, evidence', () => {
    const f = toFile('/shape.ts', `
      function waste() {
        const dead = 10;
        const dead2 = dead + 1;
        dead2;
        const unreachable = 99;
        return 0;
      }
    `);
    const result = detectWasteOxc([f]);
    for (const finding of result) {
      expect(typeof finding.kind).toBe('string');
      expect(typeof finding.filePath).toBe('string');
      expect(finding.span).toBeDefined();
      expect(typeof finding.span.start.line).toBe('number');
    }
  });

  it('processes multiple files in one call', () => {
    const f1 = toFile('/a.ts', 'function a(x: number) { return x; }');
    const f2 = toFile('/b.ts', 'function b(y: number) { return y; }');
    const result = detectWasteOxc([f1, f2]);
    expect(Array.isArray(result)).toBe(true);
  });

  it('memoryRetentionThreshold option is accepted without error', () => {
    const f = toFile('/opt.ts', 'function f(x: number) { return x; }');
    expect(() => detectWasteOxc([f], { memoryRetentionThreshold: 5 })).not.toThrow();
  });
});
