import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { analyzeErrorFlow, parseSource } from '../../../../src/test-api';
import { createTempGildash } from '../../shared/gildash-test-kit';

// False positives found by scanning real open-source code (ky, etc.) with a real-typed gildash.

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

describe('corpus FP — missing-error-cause: cause value behind a TS cast (ky Ky.ts:979)', () => {
  it('does NOT flag `{ cause: error as Error }` (the cast still forwards the caught error)', async () => {
    const code = [
      'class NetworkError extends Error { constructor(req: unknown, opts?: ErrorOptions) { super("net", opts); } }',
      'export function f(req: unknown): void {',
      '  try { work(); } catch (error) { throw new NetworkError(req, { cause: error as Error }); }',
      '}',
      'declare function work(): void;',
    ].join('\n');

    expect(await kindsFor(code)).not.toContain('missing-error-cause');
  });

  it('does NOT flag `{ cause: error! }` (non-null assertion)', async () => {
    const code = [
      'export function f(): void {',
      '  try { work(); } catch (error) { throw new Error("x", { cause: error! }); }',
      '}',
      'declare function work(): void;',
    ].join('\n');

    expect(await kindsFor(code)).not.toContain('missing-error-cause');
  });

  it('guard: still flags when the cause is a DERIVED value behind a cast, not the error', async () => {
    const code = [
      'export function f(): void {',
      '  try { work(); } catch (error: any) { throw new Error("x", { cause: error.inner as Error }); }',
      '}',
      'declare function work(): void;',
    ].join('\n');

    expect(await kindsFor(code)).toContain('missing-error-cause');
  });
});
