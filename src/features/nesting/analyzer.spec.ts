import { describe, expect, it } from 'bun:test';

import { analyzeNesting, createEmptyNesting } from './analyzer';
import { parseSource } from '../../engine/parse-source';
import type { ParsedFile } from '../../engine/types';

const toFile = (filePath: string, code: string): ParsedFile =>
  parseSource(filePath, code) as ParsedFile;

describe('features/nesting/analyzer — createEmptyNesting', () => {
  it('returns empty array', () => {
    expect(createEmptyNesting()).toEqual([]);
  });
});

describe('features/nesting/analyzer — analyzeNesting', () => {
  it('returns empty array for empty files list', () => {
    expect(analyzeNesting([])).toEqual([]);
  });

  it('skips files with parse errors', () => {
    const bad: ParsedFile = {
      filePath: '/bad.ts',
      program: {} as never,
      errors: [{ message: 'err' }] as never as [],
      comments: [],
      sourceText: '',
    };
    expect(analyzeNesting([bad])).toEqual([]);
  });

  it('returns NestingItem for a deeply nested function (maxDepth >= 3)', () => {
    // NestingItem is only emitted when maxDepth >= 3, cognitiveComplexity >= 15,
    // callbackDepth >= 3, or accidental-quadratic found.
    const f = toFile('/deep3.ts', `
      function nested(a: number, b: number, c: number): number {
        if (a > 0) {
          if (b > 0) {
            if (c > 0) {
              return a + b + c;
            }
          }
        }
        return 0;
      }
    `);
    const items = analyzeNesting([f]);
    expect(items.length).toBeGreaterThanOrEqual(1);
    const item = items[0];
    expect(item.file).toBe('/deep3.ts');
    expect(typeof item.header).toBe('string');
    expect(typeof item.metrics.depth).toBe('number');
    expect(item.metrics.depth).toBeGreaterThanOrEqual(3);
  });

  it('reports maxDepth and kind for deeply nested function vs flat function', () => {
    // deep function (3+ levels) becomes a finding; flat does not
    const flat = toFile('/flat.ts', `
      function flat(x: number): number {
        return x + 1;
      }
    `);
    const deep = toFile('/deep.ts', `
      function deep(a: number, b: number, c: number): number {
        if (a > 0) {
          if (b > 0) {
            if (c > 0) {
              return a + b + c;
            }
          }
        }
        return 0;
      }
    `);
    const flatItems = analyzeNesting([flat]);
    const deepItems = analyzeNesting([deep]);
    // flat function should NOT be a finding
    expect(flatItems.length).toBe(0);
    // deep function SHOULD be a finding
    expect(deepItems.length).toBeGreaterThanOrEqual(1);
    expect(deepItems[0].metrics.depth).toBeGreaterThanOrEqual(3);
  });

  it('NestingItem has required fields: filePath, header, maxDepth, span', () => {
    // Use a 3-level deep function to guarantee a NestingItem is emitted
    const f = toFile('/item.ts', `
      function myFunc(a: number, b: number, c: number) {
        if (a > 0) {
          if (b > 0) {
            if (c > 0) {
              return 1;
            }
          }
        }
        return 0;
      }
    `);
    const items = analyzeNesting([f]);
    expect(items.length).toBeGreaterThanOrEqual(1);
    const item = items[0];
    expect(typeof item.file).toBe('string');
    expect(typeof item.header).toBe('string');
    expect(typeof item.metrics.depth).toBe('number');
    expect(item.span).toBeDefined();
    expect(typeof item.span.start.line).toBe('number');
    expect(typeof item.span.end.line).toBe('number');
  });

  it('processes multiple files (only findings emitted)', () => {
    const nested = `function fn(a: number, b: number, c: number) {
      if (a > 0) { if (b > 0) { if (c > 0) { return 1; } } }
      return 0;
    }`;
    const f1 = toFile('/a.ts', nested);
    const f2 = toFile('/b.ts', nested);
    const items = analyzeNesting([f1, f2]);
    expect(items.length).toBeGreaterThanOrEqual(2);
    const paths = items.map(i => i.file);
    expect(paths.some(p => p === '/a.ts')).toBe(true);
    expect(paths.some(p => p === '/b.ts')).toBe(true);
  });

  it('score field is present and is a number', () => {
    // Use 3-level nesting to guarantee a finding
    const f = toFile('/score.ts', `
      function withLogic(x: number): number {
        if (x > 0) {
          if (x > 5) {
            if (x > 10) {
              return x * 2;
            }
          }
        }
        return x;
      }
    `);
    const items = analyzeNesting([f]);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(typeof items[0].score).toBe('number');
  });

  it('arrow functions deeply nested are analyzed', () => {
    // Arrow function with 3-level nesting
    const f = toFile('/arrow.ts', `
      const fn = (a: number, b: number, c: number): number => {
        if (a > 0) {
          if (b > 0) {
            if (c > 0) {
              return a + b + c;
            }
          }
        }
        return 0;
      };
    `);
    const items = analyzeNesting([f]);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].metrics.depth).toBeGreaterThanOrEqual(3);
  });
});
