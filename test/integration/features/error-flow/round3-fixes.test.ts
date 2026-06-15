import { describe, expect, it } from 'bun:test';

import { errorFlowKindsFor } from './error-flow-kit';

// Defects from the third triangulated review.

interface KindCase {
  readonly name: string;
  readonly code: string;
}

describe('catch-or-return — `.then(onOk, <non-handler>)` is not a real catch', () => {
  const flaggedCases: KindCase[] = [
    {
      name: 'flags a discarded `.then(ok, undefined)` (the second arg handles nothing)',
      code: [
        'declare function go(): Promise<void>;',
        'declare function ok(): void;',
        'export function f(): void { go().then(ok, undefined); }',
      ].join('\n'),
    },
    {
      name: 'flags a discarded `.then(ok, null)`',
      code: [
        'declare function go(): Promise<void>;',
        'declare function ok(): void;',
        'export function f(): void { go().then(ok, null); }',
      ].join('\n'),
    },
  ];

  it.each(flaggedCases)('$name', async ({ code }) => {
    expect(await errorFlowKindsFor(code)).toContain('catch-or-return');
  });

  it('guard: still K for a real `.then(ok, onErr)` rejection handler', async () => {
    const code = [
      'declare function go(): Promise<void>;',
      'declare function ok(): void;',
      'declare function onErr(e: unknown): void;',
      'export function f(): void { go().then(ok, onErr); }',
    ].join('\n');

    expect(await errorFlowKindsFor(code)).not.toContain('catch-or-return');
  });
});

describe('unobserved-variable — destructured / default / rest shadowing param', () => {
  const flaggedCases: KindCase[] = [
    {
      name: 'flags the outer promise when a destructured param shadows its name',
      code: [
        'declare function a(): Promise<number>;',
        'export function f(): void { const p = a(); const g = ({ p }: { p: number }) => p; g({ p: 1 }); }',
      ].join('\n'),
    },
    {
      name: 'flags the outer promise when a default-valued param shadows its name',
      code: [
        'declare function a(): Promise<number>;',
        'export function f(): void { const p = a(); const g = (p: number = 0) => p; g(); }',
      ].join('\n'),
    },
    {
      name: 'flags the outer promise when an array-destructured param shadows its name',
      code: [
        'declare function a(): Promise<number>;',
        'export function f(): void { const p = a(); const g = ([p]: number[]) => p; g([1]); }',
      ].join('\n'),
    },
    {
      name: 'flags the outer promise when a rest param shadows its name',
      code: [
        'declare function a(): Promise<number>;',
        'export function f(): void { const p = a(); const g = (...p: number[]) => p[0]; g(1); }',
      ].join('\n'),
    },
  ];

  it.each(flaggedCases)('$name', async ({ code }) => {
    expect(await errorFlowKindsFor(code)).toContain('unobserved-variable');
  });
});

describe('missing-error-cause — spread forwarding of the caught error (FP guard)', () => {
  it('does NOT flag when the caught error is spread into the constructor', async () => {
    const code = [
      'class DomainError extends Error { constructor(...args: unknown[]) { super(); } }',
      'export function f(): void { try { g(); } catch (e) { throw new DomainError(...[e]); } }',
      'declare function g(): void;',
    ].join('\n');

    expect(await errorFlowKindsFor(code)).not.toContain('missing-error-cause');
  });
});
