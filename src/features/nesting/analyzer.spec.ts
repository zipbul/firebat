import { describe, expect, it } from 'bun:test';

import type { ParsedFile } from '../../engine/types';

import { parseSource } from '../../engine/ast/parse-source';
import { analyzeNesting, createEmptyNesting } from './analyzer';

const toFile = (filePath: string, code: string): ParsedFile => parseSource(filePath, code) as ParsedFile;

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
    const f = toFile(
      '/deep3.ts',
      `
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
    `,
    );
    const items = analyzeNesting([f]);
    expect(items.length).toBeGreaterThanOrEqual(1);
    const item = items[0]!;
    expect(item.file).toBe('/deep3.ts');
    expect(typeof item.header).toBe('string');
    expect(typeof item.metrics.depth).toBe('number');
    expect(item.metrics.depth).toBeGreaterThanOrEqual(3);
  });

  it('reports maxDepth and kind for deeply nested function vs flat function', () => {
    // deep function (3+ levels) becomes a finding; flat does not
    const flat = toFile(
      '/flat.ts',
      `
      function flat(x: number): number {
        return x + 1;
      }
    `,
    );
    const deep = toFile(
      '/deep.ts',
      `
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
    `,
    );
    const flatItems = analyzeNesting([flat]);
    const deepItems = analyzeNesting([deep]);
    // flat function should NOT be a finding
    expect(flatItems.length).toBe(0);
    // deep function SHOULD be a finding
    expect(deepItems.length).toBeGreaterThanOrEqual(1);
    expect(deepItems[0]!.metrics.depth).toBeGreaterThanOrEqual(3);
  });

  it('NestingItem has required fields: filePath, header, maxDepth, span', () => {
    // Use a 3-level deep function to guarantee a NestingItem is emitted
    const f = toFile(
      '/item.ts',
      `
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
    `,
    );
    const items = analyzeNesting([f]);
    expect(items.length).toBeGreaterThanOrEqual(1);
    const item = items[0]!;
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
    const f = toFile(
      '/score.ts',
      `
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
    `,
    );
    const items = analyzeNesting([f]);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(typeof items[0]!.score).toBe('number');
  });

  it('arrow functions deeply nested are analyzed', () => {
    // Arrow function with 3-level nesting
    const f = toFile(
      '/arrow.ts',
      `
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
    `,
    );
    const items = analyzeNesting([f]);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0]!.metrics.depth).toBeGreaterThanOrEqual(3);
  });

  it('LogicalExpression — SonarJS: || is free, && counts per sequence', () => {
    // SonarJS S3776: || and ?? are completely free, only && counts +1 per new sequence
    const sameAnd = toFile(
      '/log1.ts',
      `
      function f(a: boolean, b: boolean, c: boolean) {
        if (a && b && c) { return 1; }
        return 0;
      }
    `,
    );
    const andThenOr = toFile(
      '/log2.ts',
      `
      function f(a: boolean, b: boolean, c: boolean) {
        if (a && b || c) { return 1; }
        return 0;
      }
    `,
    );
    const twoAndGroups = toFile(
      '/log3.ts',
      `
      function f(a: boolean, b: boolean, c: boolean, d: boolean) {
        if (a && b || c && d) { return 1; }
        return 0;
      }
    `,
    );
    const orOnly = toFile(
      '/log4.ts',
      `
      function f(a: boolean, b: boolean, c: boolean) {
        if (a || b || c) { return 1; }
        return 0;
      }
    `,
    );
    // Force findings via low threshold
    const opts = { maxCognitiveComplexity: 1, maxCallbackDepth: 99, maxNestingDepth: 99, minDensityLoc: 999, maxDensity: 1 };
    const items1 = analyzeNesting([sameAnd], opts);
    const items2 = analyzeNesting([andThenOr], opts);
    const items3 = analyzeNesting([twoAndGroups], opts);
    const items4 = analyzeNesting([orOnly], opts);

    expect(items1.length).toBe(1);
    expect(items2.length).toBe(1);
    expect(items3.length).toBe(1);

    // if(+1) + &&(+1) = 2 for a && b && c
    expect(items1[0]!.metrics.cognitiveComplexity).toBe(2);
    // if(+1) + &&(+1) = 2 for a && b || c (|| is free)
    expect(items2[0]!.metrics.cognitiveComplexity).toBe(2);
    // if(+1) + &&(+1) + &&(+1) = 3 for a && b || c && d (two && sequences)
    expect(items3[0]!.metrics.cognitiveComplexity).toBe(3);
    // if(+1) = 1 for a || b || c (|| is completely free)
    expect(items4[0]!.metrics.cognitiveComplexity).toBe(1);
  });

  it('else if — +1 only, no depth bonus', () => {
    // if(+1+0) else-if(+1) else-if(+1) = CC 3
    const f = toFile(
      '/elseif.ts',
      `
      function f(x: number) {
        if (x === 1) { return 'a'; }
        else if (x === 2) { return 'b'; }
        else if (x === 3) { return 'c'; }
        return 'd';
      }
    `,
    );
    const opts = { maxCognitiveComplexity: 1, maxCallbackDepth: 99, maxNestingDepth: 99, minDensityLoc: 999, maxDensity: 1 };
    const items = analyzeNesting([f], opts);

    expect(items.length).toBe(1);
    expect(items[0]!.metrics.cognitiveComplexity).toBe(3);
  });

  it('else — adds +1', () => {
    // if(+1+0) else(+1) = CC 2
    const f = toFile(
      '/else.ts',
      `
      function f(x: boolean) {
        if (x) { return 'a'; }
        else { return 'b'; }
      }
    `,
    );
    const opts = { maxCognitiveComplexity: 1, maxCallbackDepth: 99, maxNestingDepth: 99, minDensityLoc: 999, maxDensity: 1 };
    const items = analyzeNesting([f], opts);

    expect(items.length).toBe(1);
    expect(items[0]!.metrics.cognitiveComplexity).toBe(2);
  });

  it('TryStatement — does not increase nesting depth', () => {
    // try { if(+1+0) } catch(+1+0) = CC 2, maxDepth=1 (only from if/catch, not try)
    const f = toFile(
      '/try.ts',
      `
      function f() {
        try {
          if (true) { return 1; }
        } catch (e) {
          return 0;
        }
        return -1;
      }
    `,
    );
    const opts = { maxCognitiveComplexity: 1, maxCallbackDepth: 99, maxNestingDepth: 99, minDensityLoc: 999, maxDensity: 1 };
    const items = analyzeNesting([f], opts);

    expect(items.length).toBe(1);
    // try does not add depth → if at depth 0: +1+0=1, catch at depth 0: +1+0=1 → CC=2
    expect(items[0]!.metrics.cognitiveComplexity).toBe(2);
    // maxDepth = 1 (from if or catch), not 2 (which it would be if try added depth)
    expect(items[0]!.metrics.depth).toBe(1);
  });

  it('labeled break — adds +1', () => {
    const f = toFile(
      '/label.ts',
      `
      function f(matrix: number[][]) {
        outer:
        for (const row of matrix) {
          for (const cell of row) {
            if (cell < 0) {
              break outer;
            }
          }
        }
      }
    `,
    );
    const opts = { maxCognitiveComplexity: 1, maxCallbackDepth: 99, maxNestingDepth: 99, minDensityLoc: 999, maxDensity: 1 };
    const items = analyzeNesting([f], opts);

    expect(items.length).toBe(1);
    // for(+1+0) + for(+1+1) + if(+1+2) + labeled-break(+1) = 7
    expect(items[0]!.metrics.cognitiveComplexity).toBe(7);
  });

  it('labeled continue — adds +1', () => {
    const f = toFile(
      '/labelcont.ts',
      `
      function f(matrix: number[][]) {
        outer:
        for (const row of matrix) {
          for (const cell of row) {
            if (cell < 0) {
              continue outer;
            }
          }
        }
      }
    `,
    );
    const opts = { maxCognitiveComplexity: 1, maxCallbackDepth: 99, maxNestingDepth: 99, minDensityLoc: 999, maxDensity: 1 };
    const items = analyzeNesting([f], opts);

    expect(items.length).toBe(1);
    // for(+1+0) + for(+1+1) + if(+1+2) + labeled-continue(+1) = 7
    expect(items[0]!.metrics.cognitiveComplexity).toBe(7);
  });

  it('complexity-density kind — triggered when CC/LOC exceeds threshold', () => {
    // Dense function: many decisions in few lines
    const f = toFile(
      '/dense.ts',
      `
      function f(a: boolean, b: boolean, c: boolean, d: boolean, e: boolean, g: boolean, h: boolean, i: boolean) {
        if (a) { if (b) { if (c) { if (d) { if (e) { if (g) { if (h) { if (i) { return 1; } } } } } } } }
        return 0;
      }
    `,
    );
    // Low density threshold to trigger, but keep other thresholds very high
    const opts = { maxCognitiveComplexity: 999, maxCallbackDepth: 99, maxNestingDepth: 99, minDensityLoc: 2, maxDensity: 0.1 };
    const items = analyzeNesting([f], opts);

    expect(items.length).toBe(1);
    expect(items[0]!.kind).toBe('complexity-density');
    expect(items[0]!.metrics.density).toBeDefined();
    expect(items[0]!.metrics.density).toBeGreaterThan(0.1);
  });

  it('configurable thresholds — custom maxNestingDepth', () => {
    // depth=2, default threshold 3 → no finding
    // custom threshold 2 → finding
    const f = toFile(
      '/cfg.ts',
      `
      function f(a: boolean, b: boolean) {
        if (a) {
          if (b) { return 1; }
        }
        return 0;
      }
    `,
    );
    expect(analyzeNesting([f]).length).toBe(0);
    expect(analyzeNesting([f], { maxNestingDepth: 2 }).length).toBe(1);
    expect(analyzeNesting([f], { maxNestingDepth: 2 })[0]!.kind).toBe('deep-nesting');
  });

  it('density field is present on findings', () => {
    const f = toFile(
      '/dens.ts',
      `
      function f(a: number, b: number, c: number) {
        if (a > 0) { if (b > 0) { if (c > 0) { return 1; } } }
        return 0;
      }
    `,
    );
    const items = analyzeNesting([f]);

    expect(items.length).toBe(1);
    expect(typeof items[0]!.metrics.density).toBe('number');
  });

  it('nullish coalescing ?? — completely free per SonarJS', () => {
    const f = toFile(
      '/nullish.ts',
      `
      function f(a: unknown, b: unknown, c: unknown) {
        if (a ?? b ?? c) { return 1; }
        return 0;
      }
    `,
    );
    const opts = { maxCognitiveComplexity: 1, maxCallbackDepth: 99, maxNestingDepth: 99, minDensityLoc: 999, maxDensity: 1 };
    const items = analyzeNesting([f], opts);

    expect(items.length).toBe(1);
    // if(+1) only — ?? is free
    expect(items[0]!.metrics.cognitiveComplexity).toBe(1);
  });

  it('ConditionalExpression — increases nesting depth per SonarQube spec', () => {
    // Nested ternary: outer ternary at depth 0 increases depth to 1,
    // inner ternary at depth 1 gets +1+1=2
    const f = toFile(
      '/ternary-nest.ts',
      `
      function f(a: boolean, b: boolean) {
        return a ? (b ? 1 : 2) : 3;
      }
    `,
    );
    const opts = { maxCognitiveComplexity: 1, maxCallbackDepth: 99, maxNestingDepth: 99, minDensityLoc: 999, maxDensity: 1 };
    const items = analyzeNesting([f], opts);

    expect(items.length).toBe(1);
    // outer ternary(+1+0) + inner ternary(+1+1) = 3
    expect(items[0]!.metrics.cognitiveComplexity).toBe(3);
    // depth=2 (outer ternary depth=1, inner ternary depth=2)
    expect(items[0]!.metrics.depth).toBe(2);
  });

  it('if-condition ternary — evaluated at parent depth, not inside if body', () => {
    // Ternary in if-condition should be at depth 0, not depth 1
    const f = toFile(
      '/if-cond-ternary.ts',
      `
      function f(a: boolean, b: boolean) {
        if (a ? b : false) { return 1; }
        return 0;
      }
    `,
    );
    const opts = { maxCognitiveComplexity: 1, maxCallbackDepth: 99, maxNestingDepth: 99, minDensityLoc: 999, maxDensity: 1 };
    const items = analyzeNesting([f], opts);

    expect(items.length).toBe(1);
    // if(+1+0) + ternary(+1+0) = 2 (ternary is at depth 0, same as if)
    expect(items[0]!.metrics.cognitiveComplexity).toBe(2);
  });

  it('try/catch/finally — try and finally free, catch is +1', () => {
    const f = toFile(
      '/trycatchfinally.ts',
      `
      function f() {
        try {
          if (true) { return 1; }
        } catch (e) {
          if (true) { return 2; }
        } finally {
          if (true) { return 3; }
        }
        return 0;
      }
    `,
    );
    const opts = { maxCognitiveComplexity: 1, maxCallbackDepth: 99, maxNestingDepth: 99, minDensityLoc: 999, maxDensity: 1 };
    const items = analyzeNesting([f], opts);

    expect(items.length).toBe(1);
    // try is free, catch(+1+0), finally is free
    // if inside try: depth 0 (try doesn't increase) → if(+1+0) = 1
    // if inside catch: depth 1 (catch increases) → if(+1+1) = 2
    // if inside finally: depth 0 (finally doesn't increase) → if(+1+0) = 1
    // total = 1 + 1 + 2 + 1 = 5
    expect(items[0]!.metrics.cognitiveComplexity).toBe(5);
  });

  it('if/else-if/else compound chain — correct CC calculation', () => {
    // if(+1+0) else-if(+1) else-if(+1) else(+1) = CC 4
    const f = toFile(
      '/compound-chain.ts',
      `
      function f(x: number) {
        if (x === 1) { return 'a'; }
        else if (x === 2) { return 'b'; }
        else if (x === 3) { return 'c'; }
        else { return 'd'; }
      }
    `,
    );
    const opts = { maxCognitiveComplexity: 1, maxCallbackDepth: 99, maxNestingDepth: 99, minDensityLoc: 999, maxDensity: 1 };
    const items = analyzeNesting([f], opts);

    expect(items.length).toBe(1);
    expect(items[0]!.metrics.cognitiveComplexity).toBe(4);
  });

  it('complexity-density — minDensityLoc boundary: below min LOC → no density finding', () => {
    // 3-line function (below minDensityLoc=8), even with high density
    const f = toFile(
      '/short-dense.ts',
      `
      function f(a: boolean, b: boolean) {
        if (a) { if (b) { return 1; } }
        return 0;
      }
    `,
    );
    // Set CC/nesting thresholds very high so only density could trigger
    const opts = { maxCognitiveComplexity: 999, maxCallbackDepth: 99, maxNestingDepth: 99, minDensityLoc: 8, maxDensity: 0.01 };
    const items = analyzeNesting([f], opts);

    // Function is too short (< minDensityLoc), so no complexity-density finding
    expect(items.length).toBe(0);
  });

  it('complexity-density — density exactly at maxDensity → no finding (> required)', () => {
    // Build a function where CC/LOC = exactly maxDensity
    const f = toFile(
      '/exact-density.ts',
      `
      function f(a: boolean, b: boolean, c: boolean, d: boolean, e: boolean, f2: boolean, g: boolean, h: boolean) {
        if (a) { return 1; }
        if (b) { return 2; }
        if (c) { return 3; }
        if (d) { return 4; }
        if (e) { return 5; }
        if (f2) { return 6; }
        if (g) { return 7; }
        if (h) { return 8; }
        return 0;
      }
    `,
    );
    // CC=8 for 8 ifs at depth 0, verify density is populated
    const baseItems = analyzeNesting([f]);
    expect(baseItems.length).toBe(1);
    expect(baseItems[0]!.kind).toBe('complexity-density');

    const actualDensity = baseItems[0]!.metrics.density;

    // Verify density > maxDensity triggers, density <= maxDensity does not
    const noDensity = analyzeNesting([f], {
      maxCognitiveComplexity: 999,
      maxCallbackDepth: 99,
      maxNestingDepth: 99,
      minDensityLoc: 2,
      maxDensity: actualDensity,
    });
    const yesDensity = analyzeNesting([f], {
      maxCognitiveComplexity: 999,
      maxCallbackDepth: 99,
      maxNestingDepth: 99,
      minDensityLoc: 2,
      maxDensity: actualDensity - 0.001,
    });

    expect(noDensity.length).toBe(0);
    expect(yesDensity.length).toBe(1);
    expect(yesDensity[0]!.kind).toBe('complexity-density');
  });

  // ── signals ─────────────────────────────────────────────────────────

  it('signals — single violation produces signals array with one element matching kind', () => {
    const f = toFile(
      '/sig-single.ts',
      `
      function f(a: number, b: number, c: number) {
        if (a > 0) { if (b > 0) { if (c > 0) { return 1; } } }
        return 0;
      }
    `,
    );
    const items = analyzeNesting([f]);

    expect(items.length).toBe(1);
    expect(items[0]!.signals).toEqual([items[0]!.kind]);
  });

  it('signals — multiple violations produce all matching kinds', () => {
    // Low thresholds: trigger both deep-nesting and high-cognitive-complexity
    const f = toFile(
      '/sig-multi.ts',
      `
      function f(a: number, b: number, c: number) {
        if (a > 0) { if (b > 0) { if (c > 0) { return 1; } } }
        return 0;
      }
    `,
    );
    const opts = { maxCognitiveComplexity: 3, maxCallbackDepth: 99, maxNestingDepth: 3, minDensityLoc: 999, maxDensity: 1, maxPromiseChainDepth: 99 };
    const items = analyzeNesting([f], opts);

    expect(items.length).toBe(1);
    expect(items[0]!.signals).toContain('high-cognitive-complexity');
    expect(items[0]!.signals).toContain('deep-nesting');
    // Primary kind should be the higher priority one
    expect(items[0]!.kind).toBe('high-cognitive-complexity');
  });

  it('signals — priority order: accidental-quadratic > high-cognitive-complexity', () => {
    const f = toFile(
      '/sig-priority.ts',
      `
      function f(items: string[]) {
        for (const a of items) {
          for (const b of items) {
            if (a === b) { continue; }
          }
        }
      }
    `,
    );
    const opts = { maxCognitiveComplexity: 1, maxCallbackDepth: 99, maxNestingDepth: 99, minDensityLoc: 999, maxDensity: 1, maxPromiseChainDepth: 99 };
    const items = analyzeNesting([f], opts);

    expect(items.length).toBe(1);
    expect(items[0]!.kind).toBe('accidental-quadratic');
    expect(items[0]!.signals).toContain('accidental-quadratic');
    expect(items[0]!.signals).toContain('high-cognitive-complexity');
  });

  // ── callback depth — test runner exclusion ─────────────────────────

  it('callback depth — describe/it/beforeEach callbacks do not increase depth', () => {
    // describe(() => { it(() => { expect() }) }) is structural, not complex
    const f = toFile(
      '/test-runner.ts',
      `
      function suite() {
        describe('foo', () => {
          beforeEach(() => {
            setup();
          });
          it('bar', () => {
            expect(1).toBe(1);
          });
        });
      }
    `,
    );
    const opts = { maxCognitiveComplexity: 999, maxCallbackDepth: 3, maxNestingDepth: 99, minDensityLoc: 999, maxDensity: 1, maxPromiseChainDepth: 99 };
    const items = analyzeNesting([f], opts);

    // describe/it/beforeEach callbacks are excluded → depth stays 0
    expect(items.length).toBe(0);
  });

  it('callback depth — non-test-runner callbacks still increase depth', () => {
    const f = toFile(
      '/real-callbacks.ts',
      `
      function f(a: number[], b: number[], c: number[]) {
        a.forEach(() => {
          b.map(() => {
            c.filter(() => {
              return true;
            });
          });
        });
      }
    `,
    );
    const opts = { maxCognitiveComplexity: 999, maxCallbackDepth: 3, maxNestingDepth: 99, minDensityLoc: 999, maxDensity: 1, maxPromiseChainDepth: 99 };
    const items = analyzeNesting([f], opts);

    expect(items.length).toBe(1);
    expect(items[0]!.kind).toBe('callback-depth');
    expect(items[0]!.metrics.callbackDepth).toBe(3);
  });

  // ── promise chain depth ─────────────────────────────────────────────

  it('promise chain — .then().then() → depth 2', () => {
    const f = toFile(
      '/promise-chain.ts',
      `
      function f(p: Promise<number>) {
        p.then(x => x + 1).then(x => x * 2);
      }
    `,
    );
    const opts = { maxCognitiveComplexity: 999, maxCallbackDepth: 99, maxNestingDepth: 99, minDensityLoc: 999, maxDensity: 1, maxPromiseChainDepth: 2 };
    const items = analyzeNesting([f], opts);

    expect(items.length).toBe(1);
    expect(items[0]!.kind).toBe('promise-chain-depth');
    expect(items[0]!.metrics.promiseChainDepth).toBe(2);
  });

  it('promise chain — .then().catch().finally() → depth 3', () => {
    const f = toFile(
      '/promise-3.ts',
      `
      function f(p: Promise<number>) {
        p.then(x => x).catch(e => e).finally(() => {});
      }
    `,
    );
    const opts = { maxCognitiveComplexity: 999, maxCallbackDepth: 99, maxNestingDepth: 99, minDensityLoc: 999, maxDensity: 1, maxPromiseChainDepth: 3 };
    const items = analyzeNesting([f], opts);

    expect(items.length).toBe(1);
    expect(items[0]!.metrics.promiseChainDepth).toBe(3);
  });

  it('promise chain — nested: .then(() => x.then()) → depth 2', () => {
    const f = toFile(
      '/promise-nested.ts',
      `
      function f(p: Promise<number>, q: Promise<number>) {
        p.then(() => q.then(x => x));
      }
    `,
    );
    const opts = { maxCognitiveComplexity: 999, maxCallbackDepth: 99, maxNestingDepth: 99, minDensityLoc: 999, maxDensity: 1, maxPromiseChainDepth: 2 };
    const items = analyzeNesting([f], opts);

    expect(items.length).toBe(1);
    expect(items[0]!.metrics.promiseChainDepth).toBe(2);
  });

  it('promise chain — threshold: maxPromiseChainDepth=3 with depth 2 → no finding', () => {
    const f = toFile(
      '/promise-under.ts',
      `
      function f(p: Promise<number>) {
        p.then(x => x).then(x => x);
      }
    `,
    );
    const opts = { maxCognitiveComplexity: 999, maxCallbackDepth: 99, maxNestingDepth: 99, minDensityLoc: 999, maxDensity: 1, maxPromiseChainDepth: 3 };
    const items = analyzeNesting([f], opts);

    expect(items.length).toBe(0);
  });

  it('promise chain — no chain → promiseChainDepth is undefined', () => {
    const f = toFile(
      '/no-promise.ts',
      `
      function f(a: number, b: number, c: number) {
        if (a > 0) { if (b > 0) { if (c > 0) { return 1; } } }
        return 0;
      }
    `,
    );
    const items = analyzeNesting([f]);

    expect(items.length).toBe(1);
    expect(items[0]!.metrics.promiseChainDepth).toBeUndefined();
  });

  // ── Halstead metrics ────────────────────────────────────────────────

  it('Halstead — simple function has volume and difficulty', () => {
    const f = toFile(
      '/halstead.ts',
      `
      function f(a: number, b: number, c: number) {
        if (a > 0) { if (b > 0) { if (c > 0) { return a + b + c; } } }
        return 0;
      }
    `,
    );
    const items = analyzeNesting([f]);

    expect(items.length).toBe(1);
    expect(typeof items[0]!.metrics.halsteadVolume).toBe('number');
    expect(typeof items[0]!.metrics.halsteadDifficulty).toBe('number');
    expect(items[0]!.metrics.halsteadVolume).toBeGreaterThan(0);
    expect(items[0]!.metrics.halsteadDifficulty).toBeGreaterThan(0);
  });

  it('Halstead — minimal function has numeric volume and difficulty', () => {
    // Force finding via low CC threshold on a minimal function
    const f = toFile(
      '/halstead-minimal.ts',
      `
      function f() {
        if (true) { return; }
      }
    `,
    );
    const opts = { maxCognitiveComplexity: 1, maxCallbackDepth: 99, maxNestingDepth: 99, minDensityLoc: 999, maxDensity: 1, maxPromiseChainDepth: 99 };
    const items = analyzeNesting([f], opts);

    expect(items.length).toBe(1);
    expect(typeof items[0]!.metrics.halsteadVolume).toBe('number');
    expect(typeof items[0]!.metrics.halsteadDifficulty).toBe('number');
  });

  it('Halstead — else-if chain counts all IfStatement operators', () => {
    // if + else-if + else-if = 3 IfStatement operators
    const elseIf = toFile(
      '/halstead-elseif.ts',
      `
      function f(x: number) {
        if (x === 1) { return 'a'; }
        else if (x === 2) { return 'b'; }
        else if (x === 3) { return 'c'; }
        return 'd';
      }
    `,
    );
    // Same logic but using nested if (not else-if)
    const nestedIf = toFile(
      '/halstead-nestedif.ts',
      `
      function g(x: number) {
        if (x === 1) { return 'a'; }
        if (x === 2) { return 'b'; }
        if (x === 3) { return 'c'; }
        return 'd';
      }
    `,
    );
    const opts = { maxCognitiveComplexity: 1, maxCallbackDepth: 99, maxNestingDepth: 99, minDensityLoc: 999, maxDensity: 1, maxPromiseChainDepth: 99 };
    const elseIfItems = analyzeNesting([elseIf], opts);
    const nestedIfItems = analyzeNesting([nestedIf], opts);

    expect(elseIfItems.length).toBe(1);
    expect(nestedIfItems.length).toBe(1);
    // Both should count 3 IfStatement operators, so same Halstead volume
    expect(elseIfItems[0]!.metrics.halsteadVolume).toBe(nestedIfItems[0]!.metrics.halsteadVolume);
  });

  it('Halstead — CallExpression counts as () operator', () => {
    // Function with call expressions should have higher volume than without
    const withCalls = toFile(
      '/halstead-call.ts',
      `
      function f(arr: number[], x: boolean) {
        if (x) { arr.push(1); arr.push(2); arr.push(3); }
        return arr;
      }
    `,
    );
    const withoutCalls = toFile(
      '/halstead-nocall.ts',
      `
      function f(x: boolean) {
        if (x) { return 1; }
        return 0;
      }
    `,
    );
    const opts = { maxCognitiveComplexity: 1, maxCallbackDepth: 99, maxNestingDepth: 99, minDensityLoc: 999, maxDensity: 1, maxPromiseChainDepth: 99 };
    const itemsWithCalls = analyzeNesting([withCalls], opts);
    const itemsWithoutCalls = analyzeNesting([withoutCalls], opts);

    expect(itemsWithCalls.length).toBe(1);
    expect(itemsWithoutCalls.length).toBe(1);
    // 3 CallExpressions (push) significantly increase volume
    expect(itemsWithCalls[0]!.metrics.halsteadVolume).toBeGreaterThan(itemsWithoutCalls[0]!.metrics.halsteadVolume * 3);
  });

  it('Halstead — SwitchCase counted as control op', () => {
    const f = toFile(
      '/halstead-switch-case.ts',
      `
      function f(x: number) {
        switch (x) {
          case 1: return 'a';
          case 2: return 'b';
          default: return 'c';
        }
      }
    `,
    );
    const opts = { maxCognitiveComplexity: 1, maxCallbackDepth: 99, maxNestingDepth: 99, minDensityLoc: 999, maxDensity: 1, maxPromiseChainDepth: 99 };
    const items = analyzeNesting([f], opts);

    expect(items.length).toBe(1);
    // SwitchStatement + 3 SwitchCase + 3 ReturnStatement = 7 operators
    expect(items[0]!.metrics.halsteadVolume).toBeGreaterThan(10);
  });

  it('Halstead — await and new counted as operators', () => {
    const withAwaitNew = toFile(
      '/halstead-await-new.ts',
      `
      async function f() {
        const a = await fetch('url');
        const b = new Error('msg');
        if (a) { return b; }
        return null;
      }
    `,
    );
    const simpleIf = toFile(
      '/halstead-simple.ts',
      `
      function g() {
        if (true) { return 1; }
        return 0;
      }
    `,
    );
    const opts = { maxCognitiveComplexity: 1, maxCallbackDepth: 99, maxNestingDepth: 99, minDensityLoc: 999, maxDensity: 1, maxPromiseChainDepth: 99 };
    const itemsAwait = analyzeNesting([withAwaitNew], opts);
    const itemsSimple = analyzeNesting([simpleIf], opts);

    expect(itemsAwait.length).toBe(1);
    expect(itemsSimple.length).toBe(1);
    // await, new, () operators should produce significantly higher volume
    expect(itemsAwait[0]!.metrics.halsteadVolume).toBeGreaterThan(itemsSimple[0]!.metrics.halsteadVolume * 2);
  });

  it('Halstead — LogicalExpression chain counts all operators', () => {
    // a && b || c && d → operators: &&, ||, && (3 logical operators)
    const f = toFile(
      '/halstead-logical.ts',
      `
      function f(a: boolean, b: boolean, c: boolean, d: boolean) {
        if (a && b || c && d) { return 1; }
        return 0;
      }
    `,
    );
    const opts = { maxCognitiveComplexity: 1, maxCallbackDepth: 99, maxNestingDepth: 99, minDensityLoc: 999, maxDensity: 1, maxPromiseChainDepth: 99 };
    const items = analyzeNesting([f], opts);

    expect(items.length).toBe(1);
    // operators: IfStatement(1) + ReturnStatement(2) + &&(2) + ||(1) = 6 total, 4 unique
    // operands: a, b, c, d, 1, 0 = 6 total, 6 unique
    // Volume = (6+6) * log2(4+6) = 12 * log2(10) ≈ 39.86
    // Actual may differ slightly due to AST node structure
    expect(items[0]!.metrics.halsteadVolume).toBeGreaterThanOrEqual(30);
    expect(items[0]!.metrics.halsteadDifficulty).toBeGreaterThanOrEqual(2);
  });
});
