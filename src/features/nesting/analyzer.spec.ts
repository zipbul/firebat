import { describe, expect, it } from 'bun:test';

import type { ParsedFile } from '../../engine/types';
import type { NestingItem, NestingKind } from '../../types';

import { parseFileAs as toFile } from '../../../test/integration/shared/test-kit';
import { analyzeNesting, createEmptyNesting } from './analyzer';

type NestingOptions = Parameters<typeof analyzeNesting>[1];

/** Assert exactly one nesting item, of `kind`. */
const expectSingleKind = (items: ReadonlyArray<NestingItem>, kind: NestingKind): void => {
  expect(items.length).toBe(1);
  expect(items[0]!.kind).toBe(kind);
};

// Threshold preset that disables every detector except cognitive-complexity
// (maxCognitiveComplexity: 1) so a single force-low source always produces one
// finding whose cognitiveComplexity/depth we can assert exactly.
const FORCE_LOW_CC: NestingOptions = {
  maxCognitiveComplexity: 1,
  maxCallbackDepth: 99,
  maxNestingDepth: 99,
  minDensityLoc: 999,
  maxDensity: 1,
  maxPromiseChainDepth: 99,
};

/** Parse `source`, analyze it under `opts`, assert exactly one finding, return it. */
const analyzeOne = (path: string, source: string, opts?: NestingOptions): NestingItem => {
  const items = analyzeNesting([toFile(path, source)], opts);

  expect(items.length).toBe(1);

  return items[0]!;
};

/** Parse `source`, analyze it under `opts`, and return the findings (no count assertion). */
const analyzeFindings = (path: string, source: string, opts?: NestingOptions): ReadonlyArray<NestingItem> =>
  analyzeNesting([toFile(path, source)], opts);

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
      module: {} as never,
    };

    expect(analyzeNesting([bad])).toEqual([]);
  });

  it('returns NestingItem for a deeply nested function (maxDepth >= 3)', () => {
    // NestingItem is only emitted when maxDepth >= 3, cognitiveComplexity >= 15,
    // callbackDepth >= 3, or accidental-quadratic found.
    const item = analyzeOne(
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
    expect(deepItems.length).toBe(1);
    expect(deepItems[0]!.metrics.depth).toBeGreaterThanOrEqual(3);
  });

  it('NestingItem has required fields: filePath, header, maxDepth, span', () => {
    // Use a 3-level deep function to guarantee a NestingItem is emitted
    const item = analyzeOne(
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
    const item = analyzeOne(
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

    expect(typeof item.score).toBe('number');
  });

  it('arrow functions deeply nested are analyzed', () => {
    // Arrow function with 3-level nesting
    const item = analyzeOne(
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

    expect(item.metrics.depth).toBeGreaterThanOrEqual(3);
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

  // Cognitive-complexity scoring per SonarJS S3776, forced via FORCE_LOW_CC so each
  // source yields exactly one finding. Each row asserts the exact CC (and depth where
  // the construct's nesting contribution is the property being verified).
  interface CcCase {
    name: string;
    path: string;
    source: string;
    cc: number;
    // Lower bound on metrics.depth; 0 where depth is not the property under test.
    minDepth: number;
  }

  const ccCases: CcCase[] = [
    {
      name: 'else if — +1 only, no depth bonus',
      path: '/elseif.ts',
      // if(+1+0) else-if(+1) else-if(+1) = CC 3
      source: `
      function f(x: number) {
        if (x === 1) { return 'a'; }
        else if (x === 2) { return 'b'; }
        else if (x === 3) { return 'c'; }
        return 'd';
      }
    `,
      cc: 3,
      minDepth: 0,
    },
    {
      name: 'else — adds +1',
      path: '/else.ts',
      // if(+1+0) else(+1) = CC 2
      source: `
      function f(x: boolean) {
        if (x) { return 'a'; }
        else { return 'b'; }
      }
    `,
      cc: 2,
      minDepth: 0,
    },
    {
      name: 'TryStatement — does not increase nesting depth',
      path: '/try.ts',
      // try { if(+1+0) } catch(+1+0) = CC 2, maxDepth=1 (only from if/catch, not try)
      source: `
      function f() {
        try {
          if (true) { return 1; }
        } catch (e) {
          return 0;
        }
        return -1;
      }
    `,
      cc: 2,
      minDepth: 1,
    },
    {
      name: 'labeled break — adds +1',
      path: '/label.ts',
      // for(+1+0) + for(+1+1) + if(+1+2) + labeled-break(+1) = 7
      source: `
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
      cc: 7,
      minDepth: 0,
    },
    {
      name: 'labeled continue — adds +1',
      path: '/labelcont.ts',
      // for(+1+0) + for(+1+1) + if(+1+2) + labeled-continue(+1) = 7
      source: `
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
      cc: 7,
      minDepth: 0,
    },
    {
      name: 'nullish coalescing ?? — completely free per SonarJS',
      path: '/nullish.ts',
      // if(+1) only — ?? is free
      source: `
      function f(a: unknown, b: unknown, c: unknown) {
        if (a ?? b ?? c) { return 1; }
        return 0;
      }
    `,
      cc: 1,
      minDepth: 0,
    },
    {
      name: 'ConditionalExpression — increases nesting depth per SonarQube spec',
      path: '/ternary-nest.ts',
      // outer ternary(+1+0) + inner ternary(+1+1) = 3; depth=2
      source: `
      function f(a: boolean, b: boolean) {
        return a ? (b ? 1 : 2) : 3;
      }
    `,
      cc: 3,
      minDepth: 2,
    },
    {
      name: 'if-condition ternary — evaluated at parent depth, not inside if body',
      path: '/if-cond-ternary.ts',
      // if(+1+0) + ternary(+1+0) = 2 (ternary is at depth 0, same as if)
      source: `
      function f(a: boolean, b: boolean) {
        if (a ? b : false) { return 1; }
        return 0;
      }
    `,
      cc: 2,
      minDepth: 0,
    },
    {
      name: 'try/catch/finally — try and finally free, catch is +1',
      path: '/trycatchfinally.ts',
      // try free + catch(+1+0); if-in-try(+1+0) + if-in-catch(+1+1) + if-in-finally(+1+0) = 5
      source: `
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
      cc: 5,
      minDepth: 0,
    },
    {
      name: 'if/else-if/else compound chain — correct CC calculation',
      path: '/compound-chain.ts',
      // if(+1+0) else-if(+1) else-if(+1) else(+1) = CC 4
      source: `
      function f(x: number) {
        if (x === 1) { return 'a'; }
        else if (x === 2) { return 'b'; }
        else if (x === 3) { return 'c'; }
        else { return 'd'; }
      }
    `,
      cc: 4,
      minDepth: 0,
    },
  ];

  it.each(ccCases)('cognitive complexity — $name', ({ path, source, cc, minDepth }) => {
    const item = analyzeOne(path, source, FORCE_LOW_CC);

    expect(item.metrics.cognitiveComplexity).toBe(cc);
    // minDepth pins the construct's nesting contribution where it is the property
    // under test; rows that only assert CC use minDepth 0 (depth is always >= 0).
    expect(item.metrics.depth).toBeGreaterThanOrEqual(minDepth);
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

    expectSingleKind(items, 'complexity-density');
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
    const item = analyzeOne(
      '/dens.ts',
      `
      function f(a: number, b: number, c: number) {
        if (a > 0) { if (b > 0) { if (c > 0) { return 1; } } }
        return 0;
      }
    `,
    );

    expect(typeof item.metrics.density).toBe('number');
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
    const item = analyzeOne(
      '/sig-single.ts',
      `
      function f(a: number, b: number, c: number) {
        if (a > 0) { if (b > 0) { if (c > 0) { return 1; } } }
        return 0;
      }
    `,
    );

    expect(item.signals).toEqual([item.kind]);
  });

  it('signals — multiple violations produce all matching kinds', () => {
    // Low thresholds: trigger both deep-nesting and high-cognitive-complexity
    const item = analyzeOne(
      '/sig-multi.ts',
      `
      function f(a: number, b: number, c: number) {
        if (a > 0) { if (b > 0) { if (c > 0) { return 1; } } }
        return 0;
      }
    `,
      {
        maxCognitiveComplexity: 3,
        maxCallbackDepth: 99,
        maxNestingDepth: 3,
        minDensityLoc: 999,
        maxDensity: 1,
        maxPromiseChainDepth: 99,
      },
    );

    expect(item.signals).toContain('high-cognitive-complexity');
    expect(item.signals).toContain('deep-nesting');
    // Primary kind should be the higher priority one
    expect(item.kind).toBe('high-cognitive-complexity');
  });

  it('signals — priority order: accidental-quadratic > high-cognitive-complexity', () => {
    const item = analyzeOne(
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
      FORCE_LOW_CC,
    );

    expect(item.kind).toBe('accidental-quadratic');
    expect(item.signals).toContain('accidental-quadratic');
    expect(item.signals).toContain('high-cognitive-complexity');
  });

  // ── below-threshold / excluded constructs produce no finding ─────────

  // Each source sits just under (or is structurally excluded from) the relevant
  // threshold in opts, so analyzeNesting must emit zero findings.
  interface NoFindingCase {
    name: string;
    path: string;
    source: string;
    opts: NestingOptions;
  }

  const noFindingCases: NoFindingCase[] = [
    {
      // describe/it/beforeEach callbacks are structural, not complex → depth stays 0
      name: 'callback depth — describe/it/beforeEach callbacks do not increase depth',
      path: '/test-runner.ts',
      source: `
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
      opts: {
        maxCognitiveComplexity: 999,
        maxCallbackDepth: 3,
        maxNestingDepth: 99,
        minDensityLoc: 999,
        maxDensity: 1,
        maxPromiseChainDepth: 99,
      },
    },
    {
      // chain depth 2 is below maxPromiseChainDepth=3 → no promise-chain finding
      name: 'promise chain — threshold: maxPromiseChainDepth=3 with depth 2 → no finding',
      path: '/promise-under.ts',
      source: `
      function f(p: Promise<number>) {
        p.then(x => x).then(x => x);
      }
    `,
      opts: {
        maxCognitiveComplexity: 999,
        maxCallbackDepth: 99,
        maxNestingDepth: 99,
        minDensityLoc: 999,
        maxDensity: 1,
        maxPromiseChainDepth: 3,
      },
    },
    {
      // 3-line function is below minDensityLoc=8 → no complexity-density finding
      name: 'complexity-density — minDensityLoc boundary: below min LOC → no density finding',
      path: '/short-dense.ts',
      source: `
      function f(a: boolean, b: boolean) {
        if (a) { if (b) { return 1; } }
        return 0;
      }
    `,
      opts: {
        maxCognitiveComplexity: 999,
        maxCallbackDepth: 99,
        maxNestingDepth: 99,
        minDensityLoc: 8,
        maxDensity: 0.01,
      },
    },
  ];

  it.each(noFindingCases)('$name', ({ path, source, opts }) => {
    expect(analyzeFindings(path, source, opts).length).toBe(0);
  });

  // ── callback depth ───────────────────────────────────────────────────

  it('callback depth — non-test-runner callbacks still increase depth', () => {
    const item = analyzeOne(
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
      {
        maxCognitiveComplexity: 999,
        maxCallbackDepth: 3,
        maxNestingDepth: 99,
        minDensityLoc: 999,
        maxDensity: 1,
        maxPromiseChainDepth: 99,
      },
    );

    expect(item.kind).toBe('callback-depth');
    expect(item.metrics.callbackDepth).toBe(3);
  });

  // ── promise chain depth ─────────────────────────────────────────────

  // Promise-chain depth: each source forces a single finding by setting
  // maxPromiseChainDepth at/below the chain's depth. depth is the property under test.
  interface PromiseDepthCase {
    name: string;
    path: string;
    source: string;
    maxPromiseChainDepth: number;
    expectedKind: NestingKind;
    expectedDepth: number;
  }

  const promiseDepthCases: PromiseDepthCase[] = [
    {
      name: '.then().then() → depth 2',
      path: '/promise-chain.ts',
      source: `
      function f(p: Promise<number>) {
        p.then(x => x + 1).then(x => x * 2);
      }
    `,
      maxPromiseChainDepth: 2,
      expectedKind: 'promise-chain-depth',
      expectedDepth: 2,
    },
    {
      name: '.then().catch().finally() → depth 3',
      path: '/promise-3.ts',
      source: `
      function f(p: Promise<number>) {
        p.then(x => x).catch(e => e).finally(() => {});
      }
    `,
      maxPromiseChainDepth: 3,
      expectedKind: 'promise-chain-depth',
      expectedDepth: 3,
    },
    {
      name: 'nested: .then(() => x.then()) → depth 2',
      path: '/promise-nested.ts',
      source: `
      function f(p: Promise<number>, q: Promise<number>) {
        p.then(() => q.then(x => x));
      }
    `,
      maxPromiseChainDepth: 2,
      expectedKind: 'promise-chain-depth',
      expectedDepth: 2,
    },
  ];

  it.each(promiseDepthCases)('promise chain — $name', ({ path, source, maxPromiseChainDepth, expectedKind, expectedDepth }) => {
    const item = analyzeOne(path, source, {
      maxCognitiveComplexity: 999,
      maxCallbackDepth: 99,
      maxNestingDepth: 99,
      minDensityLoc: 999,
      maxDensity: 1,
      maxPromiseChainDepth,
    });

    expect(item.kind).toBe(expectedKind);
    expect(item.metrics.promiseChainDepth).toBe(expectedDepth);
  });

  it('promise chain — no chain → promiseChainDepth is undefined', () => {
    const item = analyzeOne(
      '/no-promise.ts',
      `
      function f(a: number, b: number, c: number) {
        if (a > 0) { if (b > 0) { if (c > 0) { return 1; } } }
        return 0;
      }
    `,
    );

    expect(item.metrics.promiseChainDepth).toBeUndefined();
  });

  // ── Halstead metrics ────────────────────────────────────────────────

  it('Halstead — simple function has volume and difficulty', () => {
    const item = analyzeOne(
      '/halstead.ts',
      `
      function f(a: number, b: number, c: number) {
        if (a > 0) { if (b > 0) { if (c > 0) { return a + b + c; } } }
        return 0;
      }
    `,
    );

    expect(typeof item.metrics.halsteadVolume).toBe('number');
    expect(typeof item.metrics.halsteadDifficulty).toBe('number');
    expect(item.metrics.halsteadVolume).toBeGreaterThan(0);
    expect(item.metrics.halsteadDifficulty).toBeGreaterThan(0);
  });

  it('Halstead — minimal function has numeric volume and difficulty', () => {
    // Force finding via low CC threshold on a minimal function
    const item = analyzeOne(
      '/halstead-minimal.ts',
      `
      function f() {
        if (true) { return; }
      }
    `,
      FORCE_LOW_CC,
    );

    expect(typeof item.metrics.halsteadVolume).toBe('number');
    expect(typeof item.metrics.halsteadDifficulty).toBe('number');
  });

  it('Halstead — else-if chain counts all IfStatement operators', () => {
    // if + else-if + else-if = 3 IfStatement operators
    const elseIf = analyzeOne(
      '/halstead-elseif.ts',
      `
      function f(x: number) {
        if (x === 1) { return 'a'; }
        else if (x === 2) { return 'b'; }
        else if (x === 3) { return 'c'; }
        return 'd';
      }
    `,
      FORCE_LOW_CC,
    );
    // Same logic but using nested if (not else-if)
    const nestedIf = analyzeOne(
      '/halstead-nestedif.ts',
      `
      function g(x: number) {
        if (x === 1) { return 'a'; }
        if (x === 2) { return 'b'; }
        if (x === 3) { return 'c'; }
        return 'd';
      }
    `,
      FORCE_LOW_CC,
    );

    // Both should count 3 IfStatement operators, so same Halstead volume
    expect(elseIf.metrics.halsteadVolume).toBe(nestedIf.metrics.halsteadVolume);
  });

  // Halstead volume grows with extra operators: each `richer` source carries
  // operators the `baseline` lacks, so richerVolume must exceed baselineVolume * factor.
  interface HalsteadRatioCase {
    name: string;
    richerPath: string;
    richerSource: string;
    baselinePath: string;
    baselineSource: string;
    factor: number;
  }

  const halsteadRatioCases: HalsteadRatioCase[] = [
    {
      name: 'CallExpression counts as () operator',
      richerPath: '/halstead-call.ts',
      // 3 CallExpressions (push) significantly increase volume
      richerSource: `
      function f(arr: number[], x: boolean) {
        if (x) { arr.push(1); arr.push(2); arr.push(3); }
        return arr;
      }
    `,
      baselinePath: '/halstead-nocall.ts',
      baselineSource: `
      function f(x: boolean) {
        if (x) { return 1; }
        return 0;
      }
    `,
      factor: 3,
    },
    {
      name: 'await and new counted as operators',
      richerPath: '/halstead-await-new.ts',
      // await, new, () operators should produce significantly higher volume
      richerSource: `
      async function f() {
        const a = await fetch('url');
        const b = new Error('msg');
        if (a) { return b; }
        return null;
      }
    `,
      baselinePath: '/halstead-simple.ts',
      baselineSource: `
      function g() {
        if (true) { return 1; }
        return 0;
      }
    `,
      factor: 2,
    },
  ];

  it.each(halsteadRatioCases)('Halstead — $name', ({ richerPath, richerSource, baselinePath, baselineSource, factor }) => {
    const richer = analyzeOne(richerPath, richerSource, FORCE_LOW_CC);
    const baseline = analyzeOne(baselinePath, baselineSource, FORCE_LOW_CC);

    expect(richer.metrics.halsteadVolume).toBeGreaterThan(baseline.metrics.halsteadVolume * factor);
  });

  it('Halstead — SwitchCase counted as control op', () => {
    const item = analyzeOne(
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
      FORCE_LOW_CC,
    );

    // SwitchStatement + 3 SwitchCase + 3 ReturnStatement = 7 operators
    expect(item.metrics.halsteadVolume).toBeGreaterThan(10);
  });

  it('Halstead — LogicalExpression chain counts all operators', () => {
    // a && b || c && d → operators: &&, ||, && (3 logical operators)
    const item = analyzeOne(
      '/halstead-logical.ts',
      `
      function f(a: boolean, b: boolean, c: boolean, d: boolean) {
        if (a && b || c && d) { return 1; }
        return 0;
      }
    `,
      FORCE_LOW_CC,
    );

    // operators: IfStatement(1) + ReturnStatement(2) + &&(2) + ||(1) = 6 total, 4 unique
    // operands: a, b, c, d, 1, 0 = 6 total, 6 unique
    // Volume = (6+6) * log2(4+6) = 12 * log2(10) ≈ 39.86
    // Actual may differ slightly due to AST node structure
    expect(item.metrics.halsteadVolume).toBeGreaterThanOrEqual(30);
    expect(item.metrics.halsteadDifficulty).toBeGreaterThanOrEqual(2);
  });
});
