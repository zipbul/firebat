import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import { analyzeIndirection, parseSource } from '../../../../src/test-api';
import { createTempGildash } from '../../shared/gildash-test-kit';

// These tests exercise the gildash-gated indirection branches against a REAL typed
// Gildash (cross-file forwarding chains via resolveSymbol/searchRelations, export
// status via searchSymbols, overload suppression, cross-file interface merging).
// The mock golden validates the AST gates fast; this proves the gildash-backed
// cross-module resolution actually fires — closing mock drift.

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

interface Finding {
  readonly kind: string;
  readonly header: string;
  readonly depth: number;
}

const analyzeFor = async (
  files: Record<string, string>,
  maxForwardDepth = 5,
): Promise<readonly Finding[]> => {
  const sources: Record<string, string> = { 'tsconfig.json': TSCONFIG };

  for (const [rel, code] of Object.entries(files)) {
    sources[`/virtual/${rel}`] = code;
  }

  const { gildash, tmpDir, cleanup } = await createTempGildash(sources, { semantic: true });

  try {
    const program = Object.keys(files).map(rel => {
      const filePath = path.join(tmpDir, rel);

      return parseSource(filePath, files[rel]!);
    });
    const findings = await analyzeIndirection(gildash, program, { maxForwardDepth, crossFileMinDepth: 2 }, tmpDir);

    return findings.map(f => ({ kind: f.kind, header: f.header, depth: f.depth }));
  } finally {
    await cleanup();
  }
};


describe('integration/indirection (real typed gildash)', () => {
  it('reports a cross-file forwarding chain across three files (resolveSymbol resolution)', async () => {
    const findings = await analyzeFor({
      'src/c.ts': 'export const real = (x: number): number => x + 1;\n',
      'src/b.ts': "import { real } from './c';\nexport const mid = (x: number): number => real(x);\n",
      'src/a.ts': "import { mid } from './b';\nexport const top = (x: number): number => mid(x);\n",
    });

    // top → mid → real is a 2-deep cross-file chain (depth ≥ crossFileMinDepth=2).
    expect(findings.map((f) => f.kind)).toContain('cross-file-forwarding-chain');
    const chain = findings.find(f => f.kind === 'cross-file-forwarding-chain' && f.header === 'top');

    expect(chain).toBeDefined();
  });

  it('does not report an exported single wrapper as thin-wrapper (cross-module, real export status)', async () => {
    const findings = await analyzeFor({
      'src/c.ts': 'export const real = (x: number): number => x + 1;\n',
      'src/a.ts': "import { real } from './c';\nexport const top = (x: number): number => real(x);\n",
    });

    // `top` is exported (its use is cross-module) → thin-wrapper gate ② cannot close
    // in-file → NOT a thin-wrapper. depth is only 1, below crossFileMinDepth → no chain either.
    expect(findings.map((f) => f.kind)).not.toContain('thin-wrapper');
    expect(findings.map((f) => f.kind)).not.toContain('cross-file-forwarding-chain');
  });

  it('reports a non-export single-file thin-wrapper (② closes in-file)', async () => {
    const findings = await analyzeFor({
      'src/a.ts': [
        'function core(x: number): number { return x * 2; }',
        'function wrapper(x: number): number { return core(x); }',
        'wrapper(1);',
      ].join('\n'),
    });

    const tw = findings.find(f => f.kind === 'thin-wrapper' && f.header === 'wrapper');

    expect(tw).toBeDefined();
  });

  it('suppresses an overloaded function whose implementation forwards (real symbol count)', async () => {
    const findings = await analyzeFor({
      'src/a.ts': [
        'function format(name: string, age?: number): string {',
        '  return age === undefined ? name : `${name}:${age}`;',
        '}',
        'export function greet(name: string): string;',
        'export function greet(name: string, age: number): string;',
        'export function greet(name: string, age?: number): string {',
        '  return format(name, age);',
        '}',
        'greet("x");',
      ].join('\n'),
    });

    // greet has overload signatures → narrowing contract → suppressed.
    expect(findings.find(f => f.header === 'greet')).toBeUndefined();
  });

  it('reports a type-remap pure synonym (no type args)', async () => {
    const findings = await analyzeFor({
      'src/a.ts': ['interface Base { id: number; }', 'export type Alias = Base;\n'].join('\n'),
    });

    expect(findings.map((f) => f.kind)).toContain('type-remap');
  });

  it('does not report a generic type alias (type args → K)', async () => {
    const findings = await analyzeFor({
      'src/a.ts': ['interface Base<T> { v: T; }', 'export type Alias = Base<number>;\n'].join('\n'),
    });

    expect(findings.map((f) => f.kind)).not.toContain('type-remap');
  });

  it('reports an empty interface extends in a module file (interface-rewrap)', async () => {
    const findings = await analyzeFor({
      'src/a.ts': ['export interface Base { id: number; }', 'export interface Wrap extends Base {}\n'].join('\n'),
    });

    expect(findings.map((f) => f.kind)).toContain('interface-rewrap');
  });
});
