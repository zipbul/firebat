import type { Gildash } from '@zipbul/gildash';

import { describe, expect, it } from 'bun:test';

import { analyzeErrorFlow, parseSource } from '../../../../src/test-api';

// Coverage gaps surfaced by the audit. All of these are SYNTACTIC paths (no gildash needed), so a
// degraded (no-semantic) gildash exercises them — closing branches that had no test.
const noopGildash = {
  isThenableAtSpan: () => null,
  getExpressionTypeAtSpan: () => null,
  getContextualCallReturnsAtSpan: () => null,
  isTypeAssignableToTypeAtSpan: () => null,
} as unknown as Gildash;

const kindsFor = (code: string): readonly string[] =>
  analyzeErrorFlow([parseSource('/virtual/src/sample.ts', code)], { gildash: noopGildash }).map(f => f.kind);

describe('coverage — misused-promises array discard paths and the full method sets', () => {
  it('flags a map result discarded by the void operator (isResultDiscarded void branch)', () => {
    const code = 'export function f(a: number[]): void { void a.map(async i => i); }';

    expect(kindsFor(code)).toContain('misused-promises');
  });

  it('flags a map result discarded as a non-final sequence operand (isResultDiscarded sequence branch)', () => {
    const code = 'export function f(a: number[]): number { return (a.map(async i => i), 0); }';

    expect(kindsFor(code)).toContain('misused-promises');
  });

  it('does NOT flag a map result kept as the final sequence operand', () => {
    const code = 'export function f(a: number[]): Promise<number>[] { return (0, a.map(async i => i)); }';

    expect(kindsFor(code)).not.toContain('misused-promises');
  });

  it.each(['some', 'every', 'find', 'findIndex', 'sort'])('flags an async callback to the always-misused method %s', method => {
    const code = `export function f(a: number[]): void { a.${method}(async x => x as unknown as boolean); }`;

    expect(kindsFor(code)).toContain('misused-promises');
  });

  it.each(['reduce', 'reduceRight'])('flags an async callback to the result method %s when the result is discarded', method => {
    const code = `export function f(a: number[]): void { a.${method}(async (acc, x) => x, 0 as unknown as number); }`;

    expect(kindsFor(code)).toContain('misused-promises');
  });
});

describe('coverage — promise-constructor-hygiene global-object member receivers', () => {
  it.each(['globalThis', 'window', 'self'])('flags an async executor on new %s.Promise(...)', global => {
    const code = [
      `declare const ${global}: any;`,
      `export const p = new ${global}.Promise(async () => { await x(); });`,
      'declare function x(): Promise<void>;',
    ].join('\n');

    expect(kindsFor(code)).toContain('promise-constructor-hygiene');
  });
});

describe('coverage — missing-error-cause skips a destructured catch param (intentional)', () => {
  it('does NOT flag `catch ({ message }) { throw new Error() }` (no whole-error binding to attach as cause)', () => {
    const code = [
      'export function f(): void {',
      '  try { g(); } catch ({ message }) { throw new Error(String(message)); }',
      '}',
      'declare function g(): void;',
    ].join('\n');

    expect(kindsFor(code)).not.toContain('missing-error-cause');
  });
});

describe('coverage — throw-non-error composite-literal shapes', () => {
  it('flags throwing an array literal', () => {
    expect(kindsFor('export function f(): never { throw [1, 2]; }')).toContain('throw-non-error');
  });

  it('flags throwing a template literal', () => {
    expect(kindsFor('export function f(): never { throw `boom ${1}`; }')).toContain('throw-non-error');
  });

  it('does NOT flag throwing a member expression of unknown type (benefit of the doubt)', () => {
    expect(kindsFor('export function f(o: { e: unknown }): never { throw o.e; }')).not.toContain('throw-non-error');
  });
});
