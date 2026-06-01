import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { analyzeErrorFlow, parseSource } from '../../../../src/test-api';
import { createTempGildash } from '../../shared/gildash-test-kit';

// unobserved-variable observation is name-keyed but must respect shadowing: a read of an inner
// function PARAMETER that shadows an outer candidate's name is a different binding and must NOT mark
// the outer (floating) promise observed. A genuine closure read (no shadow) still observes it.

const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', lib: ['ES2022'] },
  include: ['src/**/*.ts'],
});
const H = 'declare function a(): Promise<number>;\ndeclare function use(x: unknown): void;\n';

const unobservedCount = async (body: string): Promise<number> => {
  const { gildash, tmpDir, cleanup } = await createTempGildash(
    { 'tsconfig.json': TSCONFIG, '/virtual/src/sample.ts': H + body },
    { semantic: true },
  );

  try {
    const fp = path.join(tmpDir, 'src', 'sample.ts');

    return analyzeErrorFlow([parseSource(fp, await Bun.file(fp).text())], { gildash }).filter(
      f => f.kind === 'unobserved-variable',
    ).length;
  } finally {
    await cleanup();
  }
};

describe('unobserved-variable — shadowing parameter does not observe the outer promise', () => {
  it('flags the outer floating promise when an inner function param shadows its name', async () => {
    expect(await unobservedCount('export function f(): void { const p = a(); function g(p: number) { return p; } g(1); }')).toBe(
      1,
    );
  });

  it('flags it for a shadowing arrow-function param too', async () => {
    expect(await unobservedCount('export function f(): void { const p = a(); const g = (p: number) => p; g(1); }')).toBe(1);
  });

  it('still flags an unrelated candidate when a parameter of the same enclosing function is read', async () => {
    expect(await unobservedCount('export function f(p: number): number { const q = a(); return p; }')).toBe(1);
  });
});

describe('unobserved-variable — genuine closure reads still observe (K guards)', () => {
  it('does NOT flag when a closure reads the outer promise (no shadow)', async () => {
    expect(
      await unobservedCount('export async function f(): Promise<void> { const p = a(); const g = () => p; await g(); }'),
    ).toBe(0);
  });

  it('does NOT flag when the outer promise is observed before the shadowing inner function', async () => {
    expect(
      await unobservedCount('export function f(): void { const p = a(); use(p); function g(p: number) { return p; } g(1); }'),
    ).toBe(0);
  });
});
