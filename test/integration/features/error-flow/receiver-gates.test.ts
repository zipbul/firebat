import { describe, expect, it } from 'bun:test';

import { type KindCase, errorFlowKindsFor } from './error-flow-kit';

// Receiver-type gates for the two syntactic fast-paths (misused-promises array methods,
// unsafe-finally `.finally(throw)`): a method named like an Array/Promise method on a receiver that
// gildash proves is NEITHER an Array NOR a thenable must NOT be flagged (RxJS, query builders, custom
// disposables). Real arrays / promises still flag. (Degraded scans keep the syntactic behaviour.)

describe('misused-promises — array fast-path receiver gate', () => {
  const flaggedCases: KindCase[] = [
    {
      name: 'guard: still flags an async callback to a real Array method',
      code: 'export function f(a: number[]): void { a.forEach(async r => { await use(r); }); }\ndeclare function use(x: number): Promise<void>;',
    },
    {
      name: 'guard: still flags on an array literal receiver',
      code: 'export function f(): void { [1, 2, 3].forEach(async r => { await use(r); }); }\ndeclare function use(x: number): Promise<void>;',
    },
  ];

  it('FP-1: does NOT flag an async callback to a non-Array method (custom builder)', async () => {
    const code = [
      'interface QB { filter(p: (r: number) => Promise<boolean>): QB; }',
      'export function f(qb: QB): void { qb.filter(async r => r > 0); }',
    ].join('\n');

    expect(await errorFlowKindsFor(code)).not.toContain('misused-promises');
  });

  it.each(flaggedCases)('$name', async ({ code }) => {
    expect(await errorFlowKindsFor(code)).toContain('misused-promises');
  });
});

describe('unsafe-finally — promise .finally receiver gate', () => {
  it('FP-2: does NOT flag `.finally(() => { throw })` on a non-thenable receiver', async () => {
    const code = [
      'interface D { finally(cb: () => void): void; }',
      'export function f(d: D): void { d.finally(() => { throw new Error("x"); }); }',
    ].join('\n');

    expect(await errorFlowKindsFor(code)).not.toContain('unsafe-finally');
  });

  it('guard: still flags `.finally(() => { throw })` on a real Promise', async () => {
    const code = 'export function f(p: Promise<void>): void { p.finally(() => { throw new Error("x"); }); }';

    expect(await errorFlowKindsFor(code)).toContain('unsafe-finally');
  });
});
