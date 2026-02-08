import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import type { UnknownProofFinding } from '../../../src/types';

import { parseSource } from '../../../src/engine/parse-source';
import { analyzeUnknownProof, DEFAULT_UNKNOWN_PROOF_BOUNDARY_GLOBS } from '../../../src/features/unknown-proof';

const writeText = async (filePath: string, text: string): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text, 'utf8');
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
    const analysis = await analyzeUnknownProof(program, {
      rootAbs,
      boundaryGlobs: DEFAULT_UNKNOWN_PROOF_BOUNDARY_GLOBS,
      tsconfigPath,
    });

    // Assert
    expect(analysis.status === 'ok' || analysis.status === 'unavailable').toBe(true);

    if (analysis.status === 'ok') {
      expect(analysis.findings.length).toBe(0);
    } else {
      expect(analysis.findings.some((f: UnknownProofFinding) => f.kind === 'tool-unavailable')).toBe(true);
    }

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
    const analysis = await analyzeUnknownProof(program, {
      rootAbs,
      boundaryGlobs: DEFAULT_UNKNOWN_PROOF_BOUNDARY_GLOBS,
      tsconfigPath,
    });

    // Assert
    expect(analysis.status === 'ok' || analysis.status === 'unavailable').toBe(true);

    if (analysis.status === 'ok') {
      expect(analysis.findings.some((f: UnknownProofFinding) => f.kind === 'unvalidated-unknown')).toBe(true);
    } else {
      expect(analysis.findings.some((f: UnknownProofFinding) => f.kind === 'tool-unavailable')).toBe(true);
    }

    await rm(rootAbs, { recursive: true, force: true });
  });

  it('should report type assertions anywhere', async () => {
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
    const analysis = await analyzeUnknownProof(program, {
      rootAbs,
      tsconfigPath,
    });

    // Assert
    expect(analysis.findings.some((f: UnknownProofFinding) => f.kind === 'type-assertion')).toBe(true);

    await rm(rootAbs, { recursive: true, force: true });
  });

  it('should report any inferred outside boundary files (tsgo proof)', async () => {
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
    const analysis = await analyzeUnknownProof(program, {
      rootAbs,
      tsconfigPath,
    });
    // Assert
    // If tsgo is unavailable in this environment, the detector should still be blocking via tool-unavailable finding.
    const hasAny = analysis.findings.some((f: UnknownProofFinding) => f.kind === 'any-inferred');
    const hasToolUnavailable = analysis.findings.some((f: UnknownProofFinding) => f.kind === 'tool-unavailable');

    expect(hasAny || hasToolUnavailable).toBe(true);

    await rm(rootAbs, { recursive: true, force: true });
  });
});
