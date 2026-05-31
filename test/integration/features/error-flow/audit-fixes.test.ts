import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { analyzeErrorFlow, parseSource } from '../../../../src/test-api';
import { createTempGildash } from '../../shared/gildash-test-kit';

// Contracts for defects found by the adversarial audit. Real-typed gildash.

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
    const filePath = path.join(tmpDir, 'src', 'sample.ts');
    return analyzeErrorFlow([parseSource(filePath, await Bun.file(filePath).text())], { gildash }).map(f => f.kind);
  } finally {
    await cleanup();
  }
};

describe('audit — missing-error-cause FP: catch param passed whole into the Error subtype', () => {
  it('FP#1: does not flag when the caught error is a direct argument (cause may be preserved)', async () => {
    const code = [
      'class DomainError extends Error { constructor(m: string, c: unknown) { super(m); } }',
      'export function f(): void { try { g(); } catch (e) { throw new DomainError("x", e); } }',
      'declare function g(): void;',
    ].join('\n');

    expect(await kindsFor(code)).not.toContain('missing-error-cause');
  });

  it('guard: still flags when only a derived value (e.message) is passed, not the error itself', async () => {
    const code = [
      'class DomainError extends Error { constructor(m: string) { super(m); } }',
      'export function f(): void { try { g(); } catch (e: any) { throw new DomainError(e.message); } }',
      'declare function g(): void;',
    ].join('\n');

    expect(await kindsFor(code)).toContain('missing-error-cause');
  });
});

describe('audit — empty-catch FN: expression-bodied trivial rejection handler', () => {
  it('FN#8: flags `.catch(() => undefined)` (swallows identically to `.catch(() => {})`)', async () => {
    const code = ['declare function go(): Promise<void>;', 'export function f(): void { go().catch(() => undefined); }'].join('\n');

    expect(await kindsFor(code)).toContain('empty-catch');
  });

  it('FN#8: flags `.catch(() => null)`', async () => {
    const code = ['declare function go(): Promise<void>;', 'export function f(): void { go().catch(() => null); }'].join('\n');

    expect(await kindsFor(code)).toContain('empty-catch');
  });

  it('guard: does not flag `.catch(e => recover(e))` (a real recovery/transform, not a swallow)', async () => {
    const code = [
      'declare function go(): Promise<void>;',
      'declare function recover(e: unknown): void;',
      'export function f(): void { go().catch(e => recover(e)); }',
    ].join('\n');

    expect(await kindsFor(code)).not.toContain('empty-catch');
  });
});

describe('audit — missing-error-cause FN: indirect wrap via assignment', () => {
  it('FN#6: flags `w = new Error(); throw w` (wrapper bound by assignment, not declaration)', async () => {
    const code = [
      'export function f(): void {',
      '  try { g(); } catch (e) {',
      '    let w: Error;',
      '    w = new Error("x");',
      '    throw w;',
      '  }',
      '}',
      'declare function g(): void;',
    ].join('\n');

    expect(await kindsFor(code)).toContain('missing-error-cause');
  });

  it('guard: does not flag when the assigned wrapper preserves the cause', async () => {
    const code = [
      'export function f(): void {',
      '  try { g(); } catch (e) {',
      '    let w: Error;',
      '    w = new Error("x", { cause: e });',
      '    throw w;',
      '  }',
      '}',
      'declare function g(): void;',
    ].join('\n');

    expect(await kindsFor(code)).not.toContain('missing-error-cause');
  });
});

describe('audit — missing-error-cause via return Promise.reject (async equivalent of throw)', () => {
  it('FN#5: flags `return Promise.reject(new Error())` (cause-less, like `throw new Error()`)', async () => {
    const code = [
      'export async function f(): Promise<void> {',
      '  try { await g(); } catch (e) { return Promise.reject(new Error("boom")); }',
      '}',
      'declare function g(): Promise<void>;',
    ].join('\n');

    expect(await kindsFor(code)).toContain('missing-error-cause');
  });

  it('guard: does not flag `return Promise.reject(e)` (the original error propagates)', async () => {
    const code = [
      'export async function f(): Promise<void> {',
      '  try { await g(); } catch (e) { return Promise.reject(e); }',
      '}',
      'declare function g(): Promise<void>;',
    ].join('\n');

    expect(await kindsFor(code)).not.toContain('missing-error-cause');
  });

  it('guard: does not flag `return Promise.reject(new Error(m, { cause: e }))`', async () => {
    const code = [
      'export async function f(): Promise<void> {',
      '  try { await g(); } catch (e: any) { return Promise.reject(new Error(e.message, { cause: e })); }',
      '}',
      'declare function g(): Promise<void>;',
    ].join('\n');

    expect(await kindsFor(code)).not.toContain('missing-error-cause');
  });

  it('guard: does not flag a nested callback `return Promise.reject(new Error())` (not the catch control flow)', async () => {
    const code = [
      'export function f(): void {',
      '  try { g(); } catch (e) { [1].map(() => { return Promise.reject(new Error("x")); }); }',
      '}',
      'declare function g(): void;',
    ].join('\n');

    expect(await kindsFor(code)).not.toContain('missing-error-cause');
  });
});
