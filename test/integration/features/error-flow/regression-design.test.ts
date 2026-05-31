import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { analyzeErrorFlow, parseSource } from '../../../../src/test-api';
import { createTempGildash } from '../../shared/gildash-test-kit';

// Design-level root-cause contracts (real-typed gildash). Each block targets one root cause from
// the perfection audit:
//   RC3 missing-error-cause: scope-aware + consistent cause-check  (FP-A reassign-with-cause, FP-B shadowed block)
//   RC4 unobserved-variable: binding-visibility aware             (FP-C exported promise binding)
//   RC5 emit discipline: at most one finding per node             (FN-E .then(f1,f2) double-emit)
//   RC6 misused-promises: callback return-type, not async keyword (FN-F non-async promise callback)
// Behaviour-level (code -> kinds). Regression guards keep the true-positive cases firing.

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
    const program = [parseSource(filePath, await Bun.file(filePath).text())];
    const findings = await analyzeErrorFlow(program, { gildash });

    return findings.map(f => f.kind);
  } finally {
    await cleanup();
  }
};

describe('integration/error-flow — RC3 missing-error-cause: cause-check + scope', () => {
  it('FP-A: does not flag when a reassigned catch param preserves cause', async () => {
    const code = [
      'export function f(): void {',
      '  try { g(); } catch (e: any) {',
      '    e = new Error("wrap", { cause: e });',
      '    throw e;',
      '  }',
      '}',
      'declare function g(): void;',
    ].join('\n');

    expect(await kindsFor(code)).not.toContain('missing-error-cause');
  });

  it('FP-B: does not flag a bare rethrow shadowed by a dead block-scoped const', async () => {
    const code = [
      'export function f(): void {',
      '  try { g(); } catch (e) {',
      '    { const e = new Error("dead-nested"); void e; }',
      '    throw e;',
      '  }',
      '}',
      'declare function g(): void;',
    ].join('\n');

    expect(await kindsFor(code)).not.toContain('missing-error-cause');
  });

  it('guard: still flags a reassignment to a cause-less new Error', async () => {
    const code = [
      'export function f(): void {',
      '  try { g(); } catch (e: any) {',
      '    e = new Error("replaced");',
      '    throw e;',
      '  }',
      '}',
      'declare function g(): void;',
    ].join('\n');

    expect(await kindsFor(code)).toContain('missing-error-cause');
  });

  it('guard: still flags a genuine indirect throw of a cause-less new Error', async () => {
    const code = [
      'export function f(): void {',
      '  try { g(); } catch (e) {',
      '    const wrapped = new Error("indirect");',
      '    throw wrapped;',
      '  }',
      '}',
      'declare function g(): void;',
    ].join('\n');

    expect(await kindsFor(code)).toContain('missing-error-cause');
  });
});

describe('integration/error-flow — RC4 unobserved-variable: binding visibility', () => {
  it('FP-C: does not flag an exported promise binding (cross-module observable)', async () => {
    const code = ['declare function load(): Promise<number>;', 'export const ready = load();'].join('\n');

    expect(await kindsFor(code)).not.toContain('unobserved-variable');
  });

  it('guard: still flags a local unobserved promise binding', async () => {
    const code = [
      'declare function load(): Promise<number>;',
      'export function f(): void { const ready = load(); }',
    ].join('\n');

    expect(await kindsFor(code)).toContain('unobserved-variable');
  });
});

describe('integration/error-flow — RC5 emit discipline: one finding per node', () => {
  it('FN-E: a .then(onOk, onErr) with node-style callbacks in both handlers emits exactly one', async () => {
    const code = [
      'declare function go(): Promise<void>;',
      'declare const fs: { readFile(p: string, cb: (e: unknown, d: unknown) => void): void };',
      'export function f(): void {',
      '  go().then(',
      '    () => { fs.readFile("a", (_e, _d) => {}); },',
      '    () => { fs.readFile("b", (_e, _d) => {}); },',
      '  );',
      '}',
    ].join('\n');

    const hits = (await kindsFor(code)).filter(k => k === 'no-callback-in-promise');

    expect(hits.length).toBe(1);
  });
});

describe('integration/error-flow — RC6 misused-promises: callback return type', () => {
  it('FN-F: flags a non-async promise-returning callback in a user void slot', async () => {
    const code = [
      'declare function run(cb: () => void): void;',
      'declare function go(): Promise<void>;',
      'export function f(): void { run(() => go()); }',
    ].join('\n');

    expect(await kindsFor(code)).toContain('misused-promises');
  });

  it('FN-F: flags a non-async promise-returning callback passed to forEach', async () => {
    const code = [
      'declare function fetchx(n: number): Promise<void>;',
      'export function f(arr: number[]): void { arr.forEach(n => fetchx(n)); }',
    ].join('\n');

    expect(await kindsFor(code)).toContain('misused-promises');
  });

  it('guard: does not flag a non-async, non-promise callback in a void slot', async () => {
    const code = [
      'declare function run(cb: () => void): void;',
      'declare function compute(): number;',
      'export function f(): void { run(() => compute()); }',
    ].join('\n');

    expect(await kindsFor(code)).not.toContain('misused-promises');
  });
});
