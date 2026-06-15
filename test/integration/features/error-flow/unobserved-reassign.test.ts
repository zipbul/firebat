import { describe, expect, it } from 'bun:test';

import { errorFlowUnobservedCount } from './error-flow-kit';

// Reassignment-chain unobserved-variable: a thenable-valued variable overwritten before its value
// is observed loses the first promise's rejection. The hard part is FP avoidance — a conditional
// reassignment, or a reassignment whose RHS reads the old value, must NOT flag.

const decls =
  'declare function a(): Promise<number>;\ndeclare function b(): Promise<number>;\ndeclare function use(x: unknown): void;\n';

const unobservedCount = async (bodyLines: string[]): Promise<number> => {
  const code = decls + ['export async function f(c: boolean): Promise<void> {', ...bodyLines.map(l => `  ${l}`), '}'].join('\n');

  return errorFlowUnobservedCount(code);
};

interface CountCase {
  readonly name: string;
  readonly body: readonly string[];
  readonly count: number;
}

describe('unobserved-variable — reassignment chain (W)', () => {
  const cases: CountCase[] = [
    { name: 'flags the overwritten promise: `let p = a(); p = b(); await p`', body: ['let p = a();', 'p = b();', 'await p;'], count: 1 },
    {
      name: 'flags the overwritten promise when reassigned to a non-thenable: `let p = a(); p = 0 as any;`',
      body: ['let p: unknown = a();', 'p = 0;', 'use(p);'],
      count: 1,
    },
  ];

  it.each(cases)('$name', async ({ body, count }) => {
    expect(await unobservedCount([...body])).toBe(count);
  });
});

describe('unobserved-variable — reassignment chain FP guards (K)', () => {
  const cases: CountCase[] = [
    {
      name: 'does NOT flag when the old value was observed before reassignment (`await p; p = b(); await p`)',
      body: ['let p = a();', 'await p;', 'p = b();', 'await p;'],
      count: 0,
    },
    {
      name: 'does NOT flag when the reassignment RHS reads the old value (`p = p.then(...)`)',
      body: ['let p = a();', 'p = p.then(x => x);', 'await p;'],
      count: 0,
    },
    {
      name: 'does NOT flag when the old value is observed via .catch before reassignment',
      body: ['let p = a();', 'p.catch(() => {});', 'p = b();', 'await p;'],
      count: 0,
    },
    {
      name: 'does NOT flag a CONDITIONAL reassignment — the original may still be the awaited value',
      body: ['let p = a();', 'if (c) { p = b(); }', 'await p;'],
      count: 0,
    },
    {
      name: 'does NOT flag a reassignment inside a loop',
      body: ['let p = a();', 'for (let i = 0; i < 1; i++) { p = b(); }', 'await p;'],
      count: 0,
    },
    {
      name: 'does NOT flag when the old value is passed to a function before reassignment',
      body: ['let p = a();', 'use(p);', 'p = b();', 'await p;'],
      count: 0,
    },
    {
      name: 'does NOT flag a conditional reassignment via the ternary operator',
      body: ['let p = a();', 'c ? (p = b()) : 0;', 'await p;'],
      count: 0,
    },
    {
      name: 'does NOT flag a logical-assignment reassignment (conservative)',
      body: ['let p = a();', 'p ||= b();', 'await p;'],
      count: 0,
    },
    {
      name: 'does NOT flag a reassignment inside a nested function (different scope)',
      body: ['let p = a();', 'const g = () => { p = b(); };', 'g();', 'await p;'],
      count: 0,
    },
  ];

  it.each(cases)('$name', async ({ body, count }) => {
    expect(await unobservedCount([...body])).toBe(count);
  });
});

describe('unobserved-variable — reassignment chain, deeper flow (precise counts)', () => {
  const cases: CountCase[] = [
    {
      name: 'flags both intermediate promises in a triple chain `p = a(); p = a(); p = a(); await p`',
      body: ['let p = a();', 'p = a();', 'p = a();', 'await p;'],
      count: 2,
    },
    {
      // The first promise definitely floats (overwritten unconditionally); the second is only
      // conditionally observed, so it is conservatively NOT flagged.
      name: 'flags only the unconditionally-overwritten promise when the new value is only conditionally awaited',
      body: ['let p = a();', 'p = b();', 'if (c) { await p; }'],
      count: 1,
    },
  ];

  it.each(cases)('$name', async ({ body, count }) => {
    expect(await unobservedCount([...body])).toBe(count);
  });
});
