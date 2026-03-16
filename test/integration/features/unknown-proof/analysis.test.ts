import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import type { UnknownProofFinding } from '../../../../src/test-api';

import { parseSource } from '../../../../src/test-api';
import { PartialResultError } from '../../../../src/test-api';
import { analyzeUnknownProof } from '../../../../src/test-api';
import { createTempGildash } from '../../shared/gildash-test-kit';

type UnknownProofRunResult =
  | { readonly ok: true; readonly findings: ReadonlyArray<UnknownProofFinding> }
  | { readonly ok: false; readonly error: unknown; readonly findings: ReadonlyArray<UnknownProofFinding> };

const runUnknownProof = async (fn: () => Promise<ReadonlyArray<UnknownProofFinding>>): Promise<UnknownProofRunResult> => {
  try {
    const findings = await fn();

    return { ok: true, findings };
  } catch (error) {
    if (error instanceof PartialResultError) {
      return { ok: false, error, findings: error.partial as ReadonlyArray<UnknownProofFinding> };
    }

    return { ok: false, error, findings: [] };
  }
};

describe('integration/unknown-proof', () => {
  it('should return PartialResultError with expression findings when gildash not available', async () => {
    // Arrange — code has both binding candidates (catch param) and expression candidates (as any)
    const code = [
      'export function fn() {',
      '  try {} catch (e) { return e; }',
      '  const x = {} as any;',
      '  return x;',
      '}',
    ].join('\n');
    const program = [parseSource('/virtual/mixed.ts', code)];
    // Act — no gildash → binding candidates trigger PartialResultError
    const result = await runUnknownProof(async () => analyzeUnknownProof(program));

    // Assert — partial result: expression findings returned, binding candidates not analyzed
    expect(result.ok).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0]!.kind).toBe('any-cast');
  });

  it('should detect any-cast expression without gildash', async () => {
    // Arrange — expression candidates (any-cast) don't need gildash
    const code = 'export const x = {} as any;';
    const program = [parseSource('/virtual/any-cast.ts', code)];
    // Act
    const result = await runUnknownProof(async () => analyzeUnknownProof(program));

    // Assert — PartialResultError with any-cast finding
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0]!.kind).toBe('any-cast');
  });

  it('should detect double-cast expression without gildash', async () => {
    // Arrange
    const code = 'interface T { x: number; }\nexport const x = "" as unknown as T;';
    const program = [parseSource('/virtual/double-cast.ts', code)];
    // Act
    const result = await runUnknownProof(async () => analyzeUnknownProof(program));

    // Assert
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0]!.kind).toBe('double-cast');
  });

  it('should return empty findings when no expression candidates and no gildash', async () => {
    // Arrange — clean code without any-cast/double-cast expressions
    const code = ['export function clean() {', '  const x: number = 42;', '  return x;', '}'].join('\n');
    const program = [parseSource('/virtual/clean.ts', code)];
    // Act — no gildash → PartialResultError for binding candidates, no expression candidates
    const result = await runUnknownProof(async () => analyzeUnknownProof(program));

    // Assert — partial result with 0 findings (no expression candidates found)
    expect(result.ok).toBe(false);
    expect(result.findings).toHaveLength(0);
  });

  describe('gildash semantic', () => {
    const TSCONFIG_STRICT_UNKNOWN = JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          useUnknownInCatchVariables: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    );

    it('should detect unknown-type catch parameter', async () => {
      // Arrange — catch (e) with unknown type, returned without narrowing
      const { gildash, tmpDir, cleanup } = await createTempGildash(
        {
          'tsconfig.json': TSCONFIG_STRICT_UNKNOWN,
          '/virtual/src/catch.ts': ['export function safeCatch() {', '  try {} catch (e) { return e; }', '}'].join('\n'),
        },
        { semantic: true },
      );

      try {
        const filePath = path.join(tmpDir, 'src', 'catch.ts');
        const program = [parseSource(filePath, await Bun.file(filePath).text())];
        // Act
        const findings = analyzeUnknownProof(program, { gildash });

        // Assert — catch param `e` is unknown and returned in untyped function → finding
        expect(findings.some((f: UnknownProofFinding) => f.kind === 'unknown-type')).toBe(true);
      } finally {
        await cleanup();
      }
    });

    it('should suppress catch parameter narrowed by instanceof', async () => {
      // Arrange — all usages of e are safe: instanceof narrows, throw rethrows
      const { gildash, tmpDir, cleanup } = await createTempGildash(
        {
          'tsconfig.json': TSCONFIG_STRICT_UNKNOWN,
          '/virtual/src/narrowed.ts': [
            'export function narrowed() {',
            '  try {',
            '    throw new Error("test");',
            '  } catch (e) {',
            '    if (e instanceof Error) {',
            '      return e.message;',
            '    }',
            '    throw e;',
            '  }',
            '}',
          ].join('\n'),
        },
        { semantic: true },
      );

      try {
        const filePath = path.join(tmpDir, 'src', 'narrowed.ts');
        const program = [parseSource(filePath, await Bun.file(filePath).text())];
        // Act
        const findings = analyzeUnknownProof(program, { gildash });

        // Assert — instanceof narrows type, throw is safe context → no findings
        expect(findings.filter((f: UnknownProofFinding) => f.kind === 'unknown-type')).toHaveLength(0);
      } finally {
        await cleanup();
      }
    });

    it('should suppress catch parameter in typed return function', async () => {
      // Arrange — return e in a function with explicit return type → safe
      const { gildash, tmpDir, cleanup } = await createTempGildash(
        {
          'tsconfig.json': TSCONFIG_STRICT_UNKNOWN,
          '/virtual/src/typed-return.ts': [
            'export function typed(): unknown {',
            '  try {} catch (e) { return e; }',
            '  return null;',
            '}',
          ].join('\n'),
        },
        { semantic: true },
      );

      try {
        const filePath = path.join(tmpDir, 'src', 'typed-return.ts');
        const program = [parseSource(filePath, await Bun.file(filePath).text())];
        // Act
        const findings = analyzeUnknownProof(program, { gildash });

        // Assert — return in typed function is safe context
        expect(findings.filter((f: UnknownProofFinding) => f.kind === 'unknown-type')).toHaveLength(0);
      } finally {
        await cleanup();
      }
    });

    it('should report no findings for clean typed code', async () => {
      // Arrange — all types are explicit, no unknown/any
      const { gildash, tmpDir, cleanup } = await createTempGildash(
        {
          'tsconfig.json': TSCONFIG_STRICT_UNKNOWN,
          '/virtual/src/clean.ts': ['export function clean() {', '  const x: number = 42;', '  return x;', '}'].join('\n'),
        },
        { semantic: true },
      );

      try {
        const filePath = path.join(tmpDir, 'src', 'clean.ts');
        const program = [parseSource(filePath, await Bun.file(filePath).text())];
        // Act
        const findings = analyzeUnknownProof(program, { gildash });

        // Assert
        expect(findings).toHaveLength(0);
      } finally {
        await cleanup();
      }
    });

    it('should suppress catch parameter cast to typed function arg', async () => {
      // Arrange — e is cast to Error then passed to a typed function
      const { gildash, tmpDir, cleanup } = await createTempGildash(
        {
          'tsconfig.json': TSCONFIG_STRICT_UNKNOWN,
          '/virtual/src/cast-arg.ts': [
            'function logError(err: Error): void { console.error(err); }',
            'export function caller() {',
            '  try {} catch (e) { logError(e as Error); }',
            '}',
          ].join('\n'),
        },
        { semantic: true },
      );

      try {
        const filePath = path.join(tmpDir, 'src', 'cast-arg.ts');
        const program = [parseSource(filePath, await Bun.file(filePath).text())];
        // Act
        const findings = analyzeUnknownProof(program, { gildash });

        // Assert — `e as Error` is TSAsExpression safe context
        expect(findings.filter((f: UnknownProofFinding) => f.kind === 'unknown-type')).toHaveLength(0);
      } finally {
        await cleanup();
      }
    });

    it('should detect catch parameter used unsafely in assignment', async () => {
      // Arrange — e assigned to a variable without narrowing → unsafe
      const { gildash, tmpDir, cleanup } = await createTempGildash(
        {
          'tsconfig.json': TSCONFIG_STRICT_UNKNOWN,
          '/virtual/src/unsafe-assign.ts': [
            'let captured: unknown;',
            'export function unsafe() {',
            '  try {} catch (e) { captured = e; }',
            '  return captured;',
            '}',
          ].join('\n'),
        },
        { semantic: true },
      );

      try {
        const filePath = path.join(tmpDir, 'src', 'unsafe-assign.ts');
        const program = [parseSource(filePath, await Bun.file(filePath).text())];
        // Act
        const findings = analyzeUnknownProof(program, { gildash });

        // Assert — e is assigned without narrowing → should produce finding
        expect(findings.some((f: UnknownProofFinding) => f.kind === 'unknown-type')).toBe(true);
      } finally {
        await cleanup();
      }
    });
  });
});
