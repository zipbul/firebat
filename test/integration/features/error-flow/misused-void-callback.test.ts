import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { analyzeErrorFlow, parseSource } from '../../../../src/test-api';
import { createTempGildash } from '../../shared/gildash-test-kit';

// The void-callback-arg case of misused-promises (typescript-eslint no-misused-promises /
// voidReturnArgument): an async (Promise-returning) callback passed into a parameter slot whose
// contextual type returns void discards the rejection at the call boundary. Implemented via the
// oracle's expectsVoidReturningCallback (gildash 0.34.0). Behaviour-level (code -> W/K): the W cases
// flag, the K cases are the guard rails.

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true,
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'bundler',
    lib: ['ES2022'],
  },
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
    const findings = analyzeErrorFlow(program, { gildash });

    return findings.map(f => f.kind);
  } finally {
    await cleanup();
  }
};

describe('integration/error-flow — misused-promises void-callback-arg (real typed gildash)', () => {
  it('flags an async callback passed to a user-defined void-returning parameter', async () => {
    const code = [
      'function run(cb: () => void): void { cb(); }',
      'declare function flush(): Promise<void>;',
      'export function f(): void {',
      '  run(async () => { await flush(); });',
      '}',
    ].join('\n');

    expect(await kindsFor(code)).toContain('misused-promises');
  });

  it('flags an async callback passed to an optional void-returning parameter', async () => {
    const code = [
      'function run(cb?: () => void): void { cb?.(); }',
      'declare function flush(): Promise<void>;',
      'export function f(): void {',
      '  run(async () => { await flush(); });',
      '}',
    ].join('\n');

    expect(await kindsFor(code)).toContain('misused-promises');
  });

  it('flags an async callback passed to a rest void-returning parameter', async () => {
    const code = [
      'function each(...cbs: Array<() => void>): void { for (const c of cbs) c(); }',
      'declare function a(): Promise<void>;',
      'export function f(): void {',
      '  each(async () => { await a(); });',
      '}',
    ].join('\n');

    expect(await kindsFor(code)).toContain('misused-promises');
  });

  it('does not flag when the parameter slot accepts a thenable return', async () => {
    const code = [
      'function run(cb: () => void | Promise<void>): void { void cb(); }',
      'declare function flush(): Promise<void>;',
      'export function f(): void {',
      '  run(async () => { await flush(); });',
      '}',
    ].join('\n');

    expect(await kindsFor(code)).not.toContain('misused-promises');
  });

  it('does not flag when the parameter slot expects a Promise return', async () => {
    const code = [
      'function run(cb: () => Promise<void>): Promise<void> { return cb(); }',
      'declare function flush(): Promise<void>;',
      'export function f(): Promise<void> {',
      '  return run(async () => { await flush(); });',
      '}',
    ].join('\n');

    expect(await kindsFor(code)).not.toContain('misused-promises');
  });

  it('does not flag a callback whose async result is explicitly voided', async () => {
    const code = [
      'function run(cb: () => void): void { cb(); }',
      'declare function flush(): Promise<void>;',
      'export function f(): void {',
      '  run(() => void flush());',
      '}',
    ].join('\n');

    expect(await kindsFor(code)).not.toContain('misused-promises');
  });

  it('does not flag a synchronous callback in a void-returning slot', async () => {
    const code = [
      'function run(cb: () => void): void { cb(); }',
      'declare function compute(): number;',
      'export function f(): void {',
      '  run(() => { compute(); });',
      '}',
    ].join('\n');

    expect(await kindsFor(code)).not.toContain('misused-promises');
  });

  it('does not flag when overload resolution selects a Promise-accepting signature', async () => {
    const code = [
      "declare function on(ev: 'a', cb: () => void): void;",
      "declare function on(ev: 'b', cb: () => Promise<void>): void;",
      'declare function flush(): Promise<void>;',
      'export function f(): void {',
      "  on('b', async () => { await flush(); });",
      '}',
    ].join('\n');

    expect(await kindsFor(code)).not.toContain('misused-promises');
  });
});
