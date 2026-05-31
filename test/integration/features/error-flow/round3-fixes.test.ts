import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { analyzeErrorFlow, parseSource } from '../../../../src/test-api';
import { createTempGildash } from '../../shared/gildash-test-kit';

// Defects from the third triangulated review.

const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', lib: ['ES2022'] },
  include: ['src/**/*.ts'],
});

const kindsFor = async (code: string): Promise<readonly string[]> => {
  const { gildash, tmpDir, cleanup } = await createTempGildash(
    { 'tsconfig.json': TSCONFIG, '/virtual/src/sample.ts': code },
    { semantic: true },
  );

  try {
    const fp = path.join(tmpDir, 'src', 'sample.ts');
    return analyzeErrorFlow([parseSource(fp, await Bun.file(fp).text())], { gildash }).map(f => f.kind);
  } finally {
    await cleanup();
  }
};

describe('catch-or-return — `.then(onOk, <non-handler>)` is not a real catch', () => {
  it('flags a discarded `.then(ok, undefined)` (the second arg handles nothing)', async () => {
    const code = ['declare function go(): Promise<void>;', 'declare function ok(): void;', 'export function f(): void { go().then(ok, undefined); }'].join(
      '\n',
    );

    expect(await kindsFor(code)).toContain('catch-or-return');
  });

  it('flags a discarded `.then(ok, null)`', async () => {
    const code = ['declare function go(): Promise<void>;', 'declare function ok(): void;', 'export function f(): void { go().then(ok, null); }'].join(
      '\n',
    );

    expect(await kindsFor(code)).toContain('catch-or-return');
  });

  it('guard: still K for a real `.then(ok, onErr)` rejection handler', async () => {
    const code = [
      'declare function go(): Promise<void>;',
      'declare function ok(): void;',
      'declare function onErr(e: unknown): void;',
      'export function f(): void { go().then(ok, onErr); }',
    ].join('\n');

    expect(await kindsFor(code)).not.toContain('catch-or-return');
  });
});

describe('unobserved-variable — destructured / default / rest shadowing param', () => {
  it('flags the outer promise when a destructured param shadows its name', async () => {
    const code = [
      'declare function a(): Promise<number>;',
      'export function f(): void { const p = a(); const g = ({ p }: { p: number }) => p; g({ p: 1 }); }',
    ].join('\n');

    expect(await kindsFor(code)).toContain('unobserved-variable');
  });

  it('flags the outer promise when a default-valued param shadows its name', async () => {
    const code = [
      'declare function a(): Promise<number>;',
      'export function f(): void { const p = a(); const g = (p: number = 0) => p; g(); }',
    ].join('\n');

    expect(await kindsFor(code)).toContain('unobserved-variable');
  });

  it('flags the outer promise when an array-destructured param shadows its name', async () => {
    const code = [
      'declare function a(): Promise<number>;',
      'export function f(): void { const p = a(); const g = ([p]: number[]) => p; g([1]); }',
    ].join('\n');

    expect(await kindsFor(code)).toContain('unobserved-variable');
  });

  it('flags the outer promise when a rest param shadows its name', async () => {
    const code = [
      'declare function a(): Promise<number>;',
      'export function f(): void { const p = a(); const g = (...p: number[]) => p[0]; g(1); }',
    ].join('\n');

    expect(await kindsFor(code)).toContain('unobserved-variable');
  });
});

describe('missing-error-cause — spread forwarding of the caught error (FP guard)', () => {
  it('does NOT flag when the caught error is spread into the constructor', async () => {
    const code = [
      'class DomainError extends Error { constructor(...args: unknown[]) { super(); } }',
      'export function f(): void { try { g(); } catch (e) { throw new DomainError(...[e]); } }',
      'declare function g(): void;',
    ].join('\n');

    expect(await kindsFor(code)).not.toContain('missing-error-cause');
  });
});
