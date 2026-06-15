import { describe, expect, it } from 'bun:test';

import { errorFlowUnobservedCount } from './error-flow-kit';

// unobserved-variable observation is name-keyed but must respect shadowing: a read of an inner
// function PARAMETER that shadows an outer candidate's name is a different binding and must NOT mark
// the outer (floating) promise observed. A genuine closure read (no shadow) still observes it.

const H = 'declare function a(): Promise<number>;\ndeclare function use(x: unknown): void;\n';

const unobservedCount = async (body: string): Promise<number> => errorFlowUnobservedCount(H + body);

interface CountCase {
  readonly name: string;
  readonly body: string;
  readonly count: number;
}

describe('unobserved-variable — shadowing parameter does not observe the outer promise', () => {
  const cases: CountCase[] = [
    {
      name: 'flags the outer floating promise when an inner function param shadows its name',
      body: 'export function f(): void { const p = a(); function g(p: number) { return p; } g(1); }',
      count: 1,
    },
    {
      name: 'flags it for a shadowing arrow-function param too',
      body: 'export function f(): void { const p = a(); const g = (p: number) => p; g(1); }',
      count: 1,
    },
    {
      name: 'still flags an unrelated candidate when a parameter of the same enclosing function is read',
      body: 'export function f(p: number): number { const q = a(); return p; }',
      count: 1,
    },
  ];

  it.each(cases)('$name', async ({ body, count }) => {
    expect(await unobservedCount(body)).toBe(count);
  });
});

describe('unobserved-variable — genuine closure reads still observe (K guards)', () => {
  const cases: CountCase[] = [
    {
      name: 'does NOT flag when a closure reads the outer promise (no shadow)',
      body: 'export async function f(): Promise<void> { const p = a(); const g = () => p; await g(); }',
      count: 0,
    },
    {
      name: 'does NOT flag when the outer promise is observed before the shadowing inner function',
      body: 'export function f(): void { const p = a(); use(p); function g(p: number) { return p; } g(1); }',
      count: 0,
    },
  ];

  it.each(cases)('$name', async ({ body, count }) => {
    expect(await unobservedCount(body)).toBe(count);
  });
});
