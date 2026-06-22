import type { Gildash } from '@zipbul/gildash';

import { expect, it } from 'bun:test';
import * as path from 'node:path';

import { analyzeErrorFlow, parseSource } from '../../../../src/test-api';
import { createTempGildash } from '../../shared/gildash-test-kit';

// Shared harness for the error-flow integration specs. Every gildash-backed spec was re-stating the
// same `TSCONFIG` + `kindsFor` (create temp gildash -> parse -> analyze -> map kinds -> cleanup)
// preamble verbatim; it lives here once so each spec only carries its distinct cases.

/** A named error-flow case: a label + the source snippet under test. */
export interface KindCase {
  readonly name: string;
  readonly code: string;
}

/** Register `it.each` asserting every case's analysis includes `kind`. */
export const itEachFlagsKind = (cases: KindCase[], kind: string): void => {
  it.each(cases)('$name', async ({ code }) => {
    expect(await errorFlowKindsFor(code)).toContain(kind);
  });
};

/** Register `it.each` asserting no case's analysis includes `kind`. */
export const itEachKeepsKind = (cases: KindCase[], kind: string): void => {
  it.each(cases)('$name', async ({ code }) => {
    expect(await errorFlowKindsFor(code)).not.toContain(kind);
  });
};

/** Default strict tsconfig used by the real-typed error-flow specs. */
export const ERROR_FLOW_TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', lib: ['ES2022'] },
  include: ['src/**/*.ts'],
});

/**
 * Run the error-flow analyzer over `code` against a REAL typed gildash and return the finding kinds.
 *
 * Writes `code` to a temp project, opens a semantic gildash, analyzes, and always cleans up.
 * Pass `tsconfig` to override the default strict config (e.g. `useUnknownInCatchVariables`).
 */
export const errorFlowKindsFor = async (code: string, tsconfig: string = ERROR_FLOW_TSCONFIG): Promise<readonly string[]> => {
  const { gildash, tmpDir, cleanup } = await createTempGildash(
    { 'tsconfig.json': tsconfig, '/virtual/src/sample.ts': code },
    { semantic: true },
  );

  try {
    const filePath = path.join(tmpDir, 'src', 'sample.ts');

    return analyzeErrorFlow([parseSource(filePath, await Bun.file(filePath).text())], { gildash }).map(f => f.kind);
  } finally {
    await cleanup();
  }
};

/**
 * Run the error-flow analyzer over `code` against a DEGRADED (no-semantic) gildash and return the
 * finding kinds. Used by the purely-syntactic coverage specs that need no type resolution.
 */
export const errorFlowKindsForSync = (code: string, gildash: Gildash): readonly string[] =>
  analyzeErrorFlow([parseSource('/virtual/src/sample.ts', code)], { gildash }).map(f => f.kind);

/**
 * Count `unobserved-variable` findings the error-flow analyzer reports for `code` (real gildash).
 */
export const errorFlowUnobservedCount = async (code: string): Promise<number> => {
  const { gildash, tmpDir, cleanup } = await createTempGildash(
    { 'tsconfig.json': ERROR_FLOW_TSCONFIG, '/virtual/src/sample.ts': code },
    { semantic: true },
  );

  try {
    const filePath = path.join(tmpDir, 'src', 'sample.ts');

    return analyzeErrorFlow([parseSource(filePath, await Bun.file(filePath).text())], { gildash }).filter(
      f => f.kind === 'unobserved-variable',
    ).length;
  } finally {
    await cleanup();
  }
};
