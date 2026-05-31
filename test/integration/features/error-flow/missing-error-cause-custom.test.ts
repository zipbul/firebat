import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { analyzeErrorFlow, parseSource } from '../../../../src/test-api';
import { createTempGildash } from '../../shared/gildash-test-kit';

// missing-error-cause for CUSTOM error classes (real-typed gildash). The Error-subtype check runs
// at the throw site through the TypeOracle (gildash isTypeAssignableToTypeAtSpan), replacing the
// former getHeritageChain post-pass. Matrix: happy / edge / negative / exception(degraded) / side-effect.

const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', lib: ['ES2022'] },
  include: ['src/**/*.ts'],
});

const kindsFor = async (code: string, semantic = true): Promise<readonly string[]> => {
  const { gildash, tmpDir, cleanup } = await createTempGildash(
    { 'tsconfig.json': TSCONFIG, '/virtual/src/sample.ts': code },
    { semantic },
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

const wrap = (decls: string, body: string): string =>
  [decls, 'export function f(): void {', '  try { g(); } catch (e: any) {', `    ${body}`, '  }', '}', 'declare function g(): void;'].join(
    '\n',
  );

describe('integration/error-flow — missing-error-cause for custom error classes', () => {
  it('happy: flags a custom Error subclass thrown without cause', async () => {
    const code = wrap('class CustomError extends Error { constructor(m: string) { super(m); } }', 'throw new CustomError(e.message);');

    expect(await kindsFor(code)).toContain('missing-error-cause');
  });

  it('edge: flags a transitive Error subclass (extends a subclass of Error)', async () => {
    const code = wrap(['class Mid extends Error {}', 'class Deep extends Mid {}'].join('\n'), 'throw new Deep();');

    expect(await kindsFor(code)).toContain('missing-error-cause');
  });

  it('edge: flags when the catch param is not referenced in the thrown custom error', async () => {
    const code = wrap('class CustomError extends Error {}', 'throw new CustomError();');

    expect(await kindsFor(code)).toContain('missing-error-cause');
  });

  it('negative: does not flag a custom Error subclass that preserves the cause', async () => {
    const code = wrap(
      'class CustomError extends Error { constructor(m: string, o?: ErrorOptions) { super(m, o); } }',
      'throw new CustomError(e.message, { cause: e });',
    );

    expect(await kindsFor(code)).not.toContain('missing-error-cause');
  });

  it('negative: does not flag throwing a non-Error custom class (not the cause rule)', async () => {
    const code = wrap('class Box { constructor(public v: unknown) {} }', 'throw new Box(e);');

    expect(await kindsFor(code)).not.toContain('missing-error-cause');
  });

  it('exception: degraded (no-semantic) gildash does not flag a custom class (conservative)', async () => {
    const code = wrap('class CustomError extends Error {}', 'throw new CustomError();');

    // Without semantic info the oracle cannot prove the Error subtype → no over-reporting.
    expect(await kindsFor(code, false)).not.toContain('missing-error-cause');
  });

  it('side-effect: a built-in Error without cause still flags (syntactic path intact)', async () => {
    const code = wrap('', 'throw new Error("wrapped");');

    expect(await kindsFor(code)).toContain('missing-error-cause');
  });
});
