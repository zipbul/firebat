import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { analyzeErrorFlow, parseSource } from '../../../../src/test-api';
import { createTempGildash } from '../../shared/gildash-test-kit';

// Reassignment-chain unobserved-variable: a thenable-valued variable overwritten before its value
// is observed loses the first promise's rejection. The hard part is FP avoidance — a conditional
// reassignment, or a reassignment whose RHS reads the old value, must NOT flag.

const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', lib: ['ES2022'] },
  include: ['src/**/*.ts'],
});

const decls = 'declare function a(): Promise<number>;\ndeclare function b(): Promise<number>;\ndeclare function use(x: unknown): void;\n';

const unobservedCount = async (bodyLines: string[]): Promise<number> => {
  const code = decls + ['export async function f(c: boolean): Promise<void> {', ...bodyLines.map(l => `  ${l}`), '}'].join('\n');
  const { gildash, tmpDir, cleanup } = await createTempGildash(
    { 'tsconfig.json': TSCONFIG, '/virtual/src/sample.ts': code },
    { semantic: true },
  );

  try {
    const fp = path.join(tmpDir, 'src', 'sample.ts');
    return analyzeErrorFlow([parseSource(fp, await Bun.file(fp).text())], { gildash }).filter(f => f.kind === 'unobserved-variable')
      .length;
  } finally {
    await cleanup();
  }
};

describe('unobserved-variable — reassignment chain (W)', () => {
  it('flags the overwritten promise: `let p = a(); p = b(); await p`', async () => {
    expect(await unobservedCount(['let p = a();', 'p = b();', 'await p;'])).toBe(1);
  });

  it('flags the overwritten promise when reassigned to a non-thenable: `let p = a(); p = 0 as any;`', async () => {
    expect(await unobservedCount(['let p: unknown = a();', 'p = 0;', 'use(p);'])).toBe(1);
  });
});

describe('unobserved-variable — reassignment chain FP guards (K)', () => {
  it('does NOT flag when the old value was observed before reassignment (`await p; p = b(); await p`)', async () => {
    expect(await unobservedCount(['let p = a();', 'await p;', 'p = b();', 'await p;'])).toBe(0);
  });

  it('does NOT flag when the reassignment RHS reads the old value (`p = p.then(...)`)', async () => {
    expect(await unobservedCount(['let p = a();', 'p = p.then(x => x);', 'await p;'])).toBe(0);
  });

  it('does NOT flag when the old value is observed via .catch before reassignment', async () => {
    expect(await unobservedCount(['let p = a();', 'p.catch(() => {});', 'p = b();', 'await p;'])).toBe(0);
  });

  it('does NOT flag a CONDITIONAL reassignment — the original may still be the awaited value', async () => {
    expect(await unobservedCount(['let p = a();', 'if (c) { p = b(); }', 'await p;'])).toBe(0);
  });

  it('does NOT flag a reassignment inside a loop', async () => {
    expect(await unobservedCount(['let p = a();', 'for (let i = 0; i < 1; i++) { p = b(); }', 'await p;'])).toBe(0);
  });

  it('does NOT flag when the old value is passed to a function before reassignment', async () => {
    expect(await unobservedCount(['let p = a();', 'use(p);', 'p = b();', 'await p;'])).toBe(0);
  });

  it('does NOT flag a conditional reassignment via the ternary operator', async () => {
    expect(await unobservedCount(['let p = a();', 'c ? (p = b()) : 0;', 'await p;'])).toBe(0);
  });

  it('does NOT flag a logical-assignment reassignment (conservative)', async () => {
    expect(await unobservedCount(['let p = a();', 'p ||= b();', 'await p;'])).toBe(0);
  });

  it('does NOT flag a reassignment inside a nested function (different scope)', async () => {
    expect(await unobservedCount(['let p = a();', 'const g = () => { p = b(); };', 'g();', 'await p;'])).toBe(0);
  });
});

describe('unobserved-variable — reassignment chain, deeper flow (precise counts)', () => {
  it('flags both intermediate promises in a triple chain `p = a(); p = a(); p = a(); await p`', async () => {
    expect(await unobservedCount(['let p = a();', 'p = a();', 'p = a();', 'await p;'])).toBe(2);
  });

  it('flags only the unconditionally-overwritten promise when the new value is only conditionally awaited', async () => {
    // The first promise definitely floats (overwritten unconditionally); the second is only
    // conditionally observed, so it is conservatively NOT flagged.
    expect(await unobservedCount(['let p = a();', 'p = b();', 'if (c) { await p; }'])).toBe(1);
  });
});
