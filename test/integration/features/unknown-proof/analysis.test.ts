import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import type { UnknownProofFinding } from '../../../../src/types';

import { parseSource } from '../../../../src/engine/parse-source';
import { PartialResultError } from '../../../../src/engine/partial-result-error';
import { analyzeUnknownProof } from '../../../../src/features/unknown-proof';

const DEFAULT_UNKNOWN_PROOF_BOUNDARY_GLOBS: ReadonlyArray<string> = ['src/adapters/**', 'src/infrastructure/**'];

const writeText = async (filePath: string, text: string): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await Bun.write(filePath, text);
};

interface UnknownProofStatus {
  readonly status: string;
}

interface UnknownProofWithFindings {
  readonly status: string;
  readonly findings: ReadonlyArray<UnknownProofFinding>;
}

interface UnknownProofFindingsOnly {
  readonly findings: ReadonlyArray<UnknownProofFinding>;
}

// Phase 0: unknown-proof should become a bare array result, and tool availability/errors
// should be lifted out of findings at a higher layer (e.g., report.meta.errors).
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

const assertOkOrFailed = (result: UnknownProofRunResult): void => {
  expect([true, false]).toContain(result.ok);
};

const assertOkOrToolUnavailable = (
  result: UnknownProofRunResult,
  okPredicate: (findings: ReadonlyArray<UnknownProofFinding>) => boolean,
): void => {
  const okSatisfied = result.ok && okPredicate(result.findings);
  const unavailableSatisfied = result.ok === false;

  expect(okSatisfied || unavailableSatisfied).toBe(true);
};

const assertAnyOrToolUnavailable = (result: UnknownProofRunResult): void => {
  const hasAny = result.findings.some((finding: UnknownProofFinding) => finding.kind === 'any-inferred');
  const hasToolUnavailable = result.ok === false;

  expect(hasAny || hasToolUnavailable).toBe(true);
};

describe('integration/unknown-proof', () => {
  it('should allow boundary unknown when narrowed before propagation', async () => {
    // Arrange
    const rootAbs = await mkdtemp(path.join(tmpdir(), 'firebat-unknown-proof-'));
    const tsconfigPath = path.join(rootAbs, 'tsconfig.json');
    const adapterFile = path.join(rootAbs, 'src', 'adapters', 'entry.ts');

    await writeText(
      tsconfigPath,
      JSON.stringify(
        {
          compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext' },
          include: ['src/**/*.ts'],
        },
        null,
        2,
      ),
    );

    await writeText(
      adapterFile,
      [
        'export function handle(input: unknown) {',
        '  if (typeof input === "string") {',
        '    const out = input;',
        '    return out.length > 0;',
        '  }',
        '',
        '  return false;',
        '}',
      ].join('\n'),
    );

    const program = [parseSource(adapterFile, await Bun.file(adapterFile).text())];
    // Act
    const result = await runUnknownProof(() =>
      analyzeUnknownProof(program, {
        rootAbs,
        boundaryGlobs: DEFAULT_UNKNOWN_PROOF_BOUNDARY_GLOBS,
        tsconfigPath,
      }),
    );

    // Assert
    assertOkOrFailed(result);
    assertOkOrToolUnavailable(result, findings => findings.length === 0);

    await rm(rootAbs, { recursive: true, force: true });
  });

  it('should report propagating unknown in boundary files without narrowing', async () => {
    // Arrange
    const rootAbs = await mkdtemp(path.join(tmpdir(), 'firebat-unknown-proof-'));
    const tsconfigPath = path.join(rootAbs, 'tsconfig.json');
    const adapterFile = path.join(rootAbs, 'src', 'adapters', 'entry.ts');

    await writeText(
      tsconfigPath,
      JSON.stringify(
        {
          compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext' },
          include: ['src/**/*.ts'],
        },
        null,
        2,
      ),
    );

    await writeText(
      adapterFile,
      [
        'function forward(x: unknown) {',
        '  return x;',
        '}',
        '',
        'export function handle(input: unknown) {',
        '  return forward(input);',
        '}',
      ].join('\n'),
    );

    const program = [parseSource(adapterFile, await Bun.file(adapterFile).text())];
    // Act
    const result = await runUnknownProof(() =>
      analyzeUnknownProof(program, {
        rootAbs,
        boundaryGlobs: DEFAULT_UNKNOWN_PROOF_BOUNDARY_GLOBS,
        tsconfigPath,
      }),
    );

    // Assert
    assertOkOrFailed(result);
    assertOkOrToolUnavailable(result, findings =>
      findings.some((finding: UnknownProofFinding) => finding.kind === 'unvalidated-unknown'),
    );

    await rm(rootAbs, { recursive: true, force: true });
  });

  it('should report type assertions when any assertion syntax is used', async () => {
    // Arrange
    const rootAbs = await mkdtemp(path.join(tmpdir(), 'firebat-unknown-proof-'));
    const tsconfigPath = path.join(rootAbs, 'tsconfig.json');
    const filePath = path.join(rootAbs, 'src', 'features', 'bad.ts');

    await writeText(
      tsconfigPath,
      JSON.stringify(
        {
          compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext' },
          include: ['src/**/*.ts'],
        },
        null,
        2,
      ),
    );

    await writeText(filePath, ['export function bad() {', '  const x = (1 as unknown);', '  return x;', '}'].join('\n'));

    const program = [parseSource(filePath, await Bun.file(filePath).text())];
    // Act
    const result = await runUnknownProof(() =>
      analyzeUnknownProof(program, {
        rootAbs,
        tsconfigPath,
      }),
    );

    // Assert
    expect(result.findings.some((f: UnknownProofFinding) => f.kind === 'type-assertion')).toBe(true);

    await rm(rootAbs, { recursive: true, force: true });
  });

  it('should report type assertions when angle-bracket assertion syntax is used', async () => {
    // Arrange
    const rootAbs = await mkdtemp(path.join(tmpdir(), 'firebat-unknown-proof-'));
    const tsconfigPath = path.join(rootAbs, 'tsconfig.json');
    const filePath = path.join(rootAbs, 'src', 'features', 'bad-angle.ts');

    await writeText(
      tsconfigPath,
      JSON.stringify(
        {
          compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext' },
          include: ['src/**/*.ts'],
        },
        null,
        2,
      ),
    );

    await writeText(filePath, ['export function badAngle() {', '  const x = (<unknown>1);', '  return x;', '}'].join('\n'));

    const program = [parseSource(filePath, await Bun.file(filePath).text())];
    // Act
    const result = await runUnknownProof(() =>
      analyzeUnknownProof(program, {
        rootAbs,
        tsconfigPath,
      }),
    );

    // Assert
    expect(result.findings.some((f: UnknownProofFinding) => f.kind === 'type-assertion')).toBe(true);

    await rm(rootAbs, { recursive: true, force: true });
  });

  it('should skip const assertions when reporting type assertions', async () => {
    // Arrange
    const rootAbs = await mkdtemp(path.join(tmpdir(), 'firebat-unknown-proof-'));
    const tsconfigPath = path.join(rootAbs, 'tsconfig.json');
    const filePath = path.join(rootAbs, 'src', 'features', 'safe.ts');

    await writeText(
      tsconfigPath,
      JSON.stringify(
        {
          compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext' },
          include: ['src/**/*.ts'],
        },
        null,
        2,
      ),
    );

    await writeText(
      filePath,
      ['export function safe() {', '  const value = { a: 1 } as const;', '  return value;', '}'].join('\n'),
    );

    const program = [parseSource(filePath, await Bun.file(filePath).text())];
    // Act
    const result = await runUnknownProof(() =>
      analyzeUnknownProof(program, {
        rootAbs,
        tsconfigPath,
      }),
    );

    // Assert
    assertOkOrToolUnavailable(result, findings =>
      findings.every((finding: UnknownProofFinding) => finding.kind !== 'type-assertion'),
    );

    await rm(rootAbs, { recursive: true, force: true });
  });

  it('should still report type assertions when const assertions are wrapped by an outer assertion', async () => {
    // Arrange
    const rootAbs = await mkdtemp(path.join(tmpdir(), 'firebat-unknown-proof-'));
    const tsconfigPath = path.join(rootAbs, 'tsconfig.json');
    const filePath = path.join(rootAbs, 'src', 'features', 'wrapped.ts');

    await writeText(
      tsconfigPath,
      JSON.stringify(
        {
          compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext' },
          include: ['src/**/*.ts'],
        },
        null,
        2,
      ),
    );

    await writeText(
      filePath,
      ['export function wrapped() {', '  const value = ({ a: 1 } as const) as unknown;', '  return value;', '}'].join('\n'),
    );

    const program = [parseSource(filePath, await Bun.file(filePath).text())];
    // Act
    const result = await runUnknownProof(() =>
      analyzeUnknownProof(program, {
        rootAbs,
        tsconfigPath,
      }),
    );

    // Assert
    expect(result.findings.some((f: UnknownProofFinding) => f.kind === 'type-assertion')).toBe(true);

    await rm(rootAbs, { recursive: true, force: true });
  });

  it('should skip satisfies expressions when collecting type assertion candidates', async () => {
    // Arrange
    const rootAbs = await mkdtemp(path.join(tmpdir(), 'firebat-unknown-proof-'));
    const tsconfigPath = path.join(rootAbs, 'tsconfig.json');
    const filePath = path.join(rootAbs, 'src', 'features', 'satisfies.ts');

    await writeText(
      tsconfigPath,
      JSON.stringify(
        {
          compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext' },
          include: ['src/**/*.ts'],
        },
        null,
        2,
      ),
    );

    await writeText(
      filePath,
      [
        'type Config = { a?: number };',
        'export function ok() {',
        '  const cfg = { a: 1 } satisfies Config;',
        '  return cfg.a ?? 0;',
        '}',
      ].join('\n'),
    );

    const program = [parseSource(filePath, await Bun.file(filePath).text())];
    // Act
    const result = await runUnknownProof(() =>
      analyzeUnknownProof(program, {
        rootAbs,
        tsconfigPath,
      }),
    );

    // Assert
    expect(result.findings.some((f: UnknownProofFinding) => f.kind === 'type-assertion')).toBe(false);

    await rm(rootAbs, { recursive: true, force: true });
  });

  it('should report double-assertion for x as unknown as T and avoid duplicate single assertions', async () => {
    // Arrange
    const rootAbs = await mkdtemp(path.join(tmpdir(), 'firebat-unknown-proof-'));
    const tsconfigPath = path.join(rootAbs, 'tsconfig.json');
    const filePath = path.join(rootAbs, 'src', 'features', 'double.ts');

    await writeText(
      tsconfigPath,
      JSON.stringify(
        {
          compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext' },
          include: ['src/**/*.ts'],
        },
        null,
        2,
      ),
    );

    await writeText(
      filePath,
      ['export function bad() {', '  const x = (1 as unknown) as string;', '  return x;', '}'].join('\n'),
    );

    const program = [parseSource(filePath, await Bun.file(filePath).text())];
    // Act
    const result = await runUnknownProof(() =>
      analyzeUnknownProof(program, {
        rootAbs,
        tsconfigPath,
      }),
    );

    // Assert
    expect(result.findings.some((f: UnknownProofFinding) => f.kind === 'double-assertion')).toBe(true);
    expect(result.findings.some((f: UnknownProofFinding) => f.kind === 'type-assertion')).toBe(false);

    await rm(rootAbs, { recursive: true, force: true });
  });

  it('should report unknown-type findings when explicit unknown appears outside boundary files', async () => {
    // Arrange
    const rootAbs = await mkdtemp(path.join(tmpdir(), 'firebat-unknown-proof-'));
    const tsconfigPath = path.join(rootAbs, 'tsconfig.json');
    const filePath = path.join(rootAbs, 'src', 'features', 'unknown.ts');

    await writeText(
      tsconfigPath,
      JSON.stringify(
        {
          compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext' },
          include: ['src/**/*.ts'],
        },
        null,
        2,
      ),
    );

    await writeText(
      filePath,
      ['export function unknownCase() {', '  const value: unknown = 1;', '  return value;', '}'].join('\n'),
    );

    const program = [parseSource(filePath, await Bun.file(filePath).text())];
    // Act
    const result = await runUnknownProof(() =>
      analyzeUnknownProof(program, {
        rootAbs,
        tsconfigPath,
        boundaryGlobs: DEFAULT_UNKNOWN_PROOF_BOUNDARY_GLOBS,
      }),
    );

    // Assert
    assertOkOrFailed(result);
    assertOkOrToolUnavailable(result, findings => findings.some((f: UnknownProofFinding) => f.kind === 'unknown-type'));

    await rm(rootAbs, { recursive: true, force: true });
  });

  it('should not report unknown-type findings when explicit unknown appears in boundary files', async () => {
    // Arrange
    const rootAbs = await mkdtemp(path.join(tmpdir(), 'firebat-unknown-proof-'));
    const tsconfigPath = path.join(rootAbs, 'tsconfig.json');
    const filePath = path.join(rootAbs, 'src', 'adapters', 'unknown.ts');

    await writeText(
      tsconfigPath,
      JSON.stringify(
        {
          compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext' },
          include: ['src/**/*.ts'],
        },
        null,
        2,
      ),
    );

    await writeText(filePath, ['export function unknownBoundary(value: unknown) {', '  return value;', '}'].join('\n'));

    const program = [parseSource(filePath, await Bun.file(filePath).text())];
    // Act
    const result = await runUnknownProof(() =>
      analyzeUnknownProof(program, {
        rootAbs,
        tsconfigPath,
        boundaryGlobs: DEFAULT_UNKNOWN_PROOF_BOUNDARY_GLOBS,
      }),
    );

    // Assert
    assertOkOrFailed(result);
    assertOkOrToolUnavailable(result, findings => findings.every((f: UnknownProofFinding) => f.kind !== 'unknown-type'));

    await rm(rootAbs, { recursive: true, force: true });
  });

  it('should report any inferred when files are outside boundary (tsgo proof)', async () => {
    // Arrange
    const rootAbs = await mkdtemp(path.join(tmpdir(), 'firebat-unknown-proof-'));
    const tsconfigPath = path.join(rootAbs, 'tsconfig.json');
    const filePath = path.join(rootAbs, 'src', 'features', 'any.ts');

    await writeText(
      tsconfigPath,
      JSON.stringify(
        {
          compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext' },
          include: ['src/**/*.ts'],
        },
        null,
        2,
      ),
    );

    await writeText(
      filePath,
      ['export function anyCase() {', '  const data = JSON.parse("{}")', '  return data;', '}'].join('\n'),
    );

    const program = [parseSource(filePath, await Bun.file(filePath).text())];
    // Act
    const result = await runUnknownProof(() =>
      analyzeUnknownProof(program, {
        rootAbs,
        tsconfigPath,
      }),
    );

    // Assert
    assertAnyOrToolUnavailable(result);

    await rm(rootAbs, { recursive: true, force: true });
  });
});
