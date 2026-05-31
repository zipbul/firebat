import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { analyzeErrorFlow, parseSource } from '../../../../src/test-api';
import { createTempGildash } from '../../shared/gildash-test-kit';

// These tests exercise the gildash-gated error-flow rules (floating bare/method/optional calls,
// empty promise rejection handler, return-await-in-try, typed throw/reject) against a REAL typed
// Gildash — the mocked specs validate the logic, this proves the type resolution actually fires.

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true,
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'bundler',
    useUnknownInCatchVariables: true,
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

describe('integration/error-flow (real typed gildash)', () => {
  it('flags a discarded bare call whose result type is a Promise', async () => {
    const code = ['declare function fetchData(): Promise<string>;', 'export function f(): void {', '  fetchData();', '}'].join('\n');

    expect(await kindsFor(code)).toContain('floating-promises');
  });

  it('flags a discarded method call returning a Promise', async () => {
    const code = [
      'class Svc { async load(): Promise<void> { await Promise.resolve(); } }',
      'export function f(s: Svc): void {',
      '  s.load();',
      '}',
    ].join('\n');

    expect(await kindsFor(code)).toContain('floating-promises');
  });

  it('flags a discarded optional method call returning a Promise', async () => {
    const code = [
      'export function f(h: { load?: () => Promise<void> }): void {',
      '  h.load?.();',
      '}',
    ].join('\n');

    expect(await kindsFor(code)).toContain('floating-promises');
  });

  it('does not flag a discarded synchronous call', async () => {
    const code = ['declare function syncFn(): number;', 'export function f(): void {', '  syncFn();', '}'].join('\n');

    expect(await kindsFor(code)).not.toContain('floating-promises');
  });

  it('does not flag a voided Promise-returning call', async () => {
    const code = ['declare function fetchData(): Promise<string>;', 'export function f(): void {', '  void fetchData();', '}'].join('\n');

    expect(await kindsFor(code)).not.toContain('floating-promises');
  });

  it('flags an empty .catch handler on a real Promise', async () => {
    const code = ['export function f(p: Promise<number>): void {', '  p.catch(() => {});', '}'].join('\n');

    expect(await kindsFor(code)).toContain('empty-catch');
  });

  it('does not flag an empty .catch on a non-Promise fluent API', async () => {
    const code = [
      'interface Query { catch(cb: () => void): Query; }',
      'export function f(q: Query): void {',
      '  q.catch(() => {});',
      '}',
    ].join('\n');

    expect(await kindsFor(code)).not.toContain('empty-catch');
  });

  it('flags return of a Promise-returning method without await inside try/catch', async () => {
    const code = [
      'class Repo { async load(): Promise<number> { return 1; } }',
      'export class C extends Repo {',
      '  async run(): Promise<number> {',
      '    try {',
      '      return this.load();',
      '    } catch {',
      '      return 0;',
      '    }',
      '  }',
      '}',
    ].join('\n');

    expect(await kindsFor(code)).toContain('return-await-in-try');
  });

  it('does not flag return of a non-Promise instance inside try/catch', async () => {
    const code = [
      'export async function f(): Promise<number[]> {',
      '  try {',
      '    return new Array<number>(3);',
      '  } catch {',
      '    return [];',
      '  }',
      '}',
    ].join('\n');

    expect(await kindsFor(code)).not.toContain('return-await-in-try');
  });

  it('flags a throw of a string-typed variable (gildash type proof)', async () => {
    const code = ['export function f(msg: string): never {', '  throw msg;', '}'].join('\n');

    expect(await kindsFor(code)).toContain('throw-non-error');
  });

  it('does not flag a throw of an Error-typed variable', async () => {
    const code = ['export function f(err: Error): never {', '  throw err;', '}'].join('\n');

    expect(await kindsFor(code)).not.toContain('throw-non-error');
  });

  it('does not flag a throw of an any-typed variable (could hold an Error)', async () => {
    const code = ['export function f(x: any): never {', '  throw x;', '}'].join('\n');

    expect(await kindsFor(code)).not.toContain('throw-non-error');
  });

  it('does not flag a throw of an unknown-typed variable', async () => {
    const code = ['export function f(x: unknown): never {', '  throw x;', '}'].join('\n');

    expect(await kindsFor(code)).not.toContain('throw-non-error');
  });

  it('flags a throw of a string-typed member (probes the property position)', async () => {
    const code = ['export function f(o: { msg: string }): never {', '  throw o.msg;', '}'].join('\n');

    expect(await kindsFor(code)).toContain('throw-non-error');
  });

  it('does not flag a throw of an Error-typed member', async () => {
    const code = ['export function f(o: { err: Error }): never {', '  throw o.err;', '}'].join('\n');

    expect(await kindsFor(code)).not.toContain('throw-non-error');
  });

  it('flags a throw of a primitive-returning call result', async () => {
    const code = ['declare function getMsg(): string;', 'export function f(): never {', '  throw getMsg();', '}'].join('\n');

    expect(await kindsFor(code)).toContain('throw-non-error');
  });

  it('does not flag a throw of an Error-returning call result', async () => {
    const code = ['declare function makeError(): Error;', 'export function f(): never {', '  throw makeError();', '}'].join('\n');

    expect(await kindsFor(code)).not.toContain('throw-non-error');
  });

  it('does not flag a throw of an any-returning call result', async () => {
    const code = ['declare function getAny(): any;', 'export function f(): never {', '  throw getAny();', '}'].join('\n');

    expect(await kindsFor(code)).not.toContain('throw-non-error');
  });

  it('flags Promise.reject with a string-typed reason', async () => {
    const code = ['export function f(reason: string): Promise<never> {', '  return Promise.reject(reason);', '}'].join('\n');

    expect(await kindsFor(code)).toContain('throw-non-error');
  });

  it('flags a Promise-typed variable that is never observed', async () => {
    const code = ['declare function fetchData(): Promise<string>;', 'export function f(): void {', '  const p = fetchData();', '}'].join('\n');

    expect(await kindsFor(code)).toContain('unobserved-variable');
  });

  it('does not flag a Promise variable that escapes via an object/array/ternary/assignment', async () => {
    const cases = [
      'const p = fetchData(); return { p };',
      'const p = fetchData(); return { wrapped: p };',
      'const p = fetchData(); return [p];',
      'const p = fetchData(); return cond ? p : null;',
    ];

    for (const body of cases) {
      const code = [
        'declare function fetchData(): Promise<string>;',
        'export function f(cond: boolean): unknown {',
        `  ${body}`,
        '}',
      ].join('\n');

      expect(await kindsFor(code)).not.toContain('unobserved-variable');
    }
  });

  it('does not flag a Promise-typed call whose result is any (e.g. JSON.parse)', async () => {
    const code = ['export function f(): void {', '  JSON.parse("{}");', '}'].join('\n');

    expect(await kindsFor(code)).not.toContain('floating-promises');
  });

  it('does not flag an empty .catch on an any-typed value', async () => {
    const code = ['export function f(p: any): void {', '  p.catch(() => {});', '}'].join('\n');

    expect(await kindsFor(code)).not.toContain('empty-catch');
  });
});
