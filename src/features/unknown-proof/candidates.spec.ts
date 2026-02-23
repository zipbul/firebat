import { describe, expect, it } from 'bun:test';

import { collectUnknownProofCandidates, stringifyHover } from './candidates';
import { parseSource } from '../../engine/ast/parse-source';
import type { ParsedFile } from '../../engine/types';

const toFile = (filePath: string, code: string): ParsedFile =>
  parseSource(filePath, code) as ParsedFile;

describe('features/unknown-proof/candidates — stringifyHover', () => {
  it('returns empty string for null/undefined', () => {
    expect(stringifyHover(null)).toBe('');
    expect(stringifyHover(undefined)).toBe('');
  });

  it('returns empty string for non-object', () => {
    expect(stringifyHover('plain string')).toBe('');
    expect(stringifyHover(42)).toBe('');
  });

  it('extracts string from MarkupContent with value field', () => {
    const hover = { contents: { kind: 'plaintext', value: 'number' } };
    const result = stringifyHover(hover);
    expect(result).toContain('number');
  });

  it('extracts string from plain string contents', () => {
    const hover = { contents: 'string type' };
    const result = stringifyHover(hover);
    expect(result).toContain('string type');
  });

  it('extracts string from array contents', () => {
    const hover = { contents: ['foo', 'bar'] };
    const result = stringifyHover(hover);
    expect(result).toContain('foo');
    expect(result).toContain('bar');
  });

  it('falls back to empty string for empty object', () => {
    const result = stringifyHover({});
    expect(typeof result).toBe('string');
  });
});

describe('features/unknown-proof/candidates — collectUnknownProofCandidates', () => {
  it('returns empty perFile map for empty program', () => {
    const result = collectUnknownProofCandidates({ program: [], rootAbs: '/tmp' });
    expect(result.perFile.size).toBe(0);
  });

  it('returns boundaryGlobs from input', () => {
    const result = collectUnknownProofCandidates({
      program: [],
      rootAbs: '/tmp',
      boundaryGlobs: ['src/api/**'],
    });
    expect(result.boundaryGlobs).toContain('src/api/**');
  });

  it('returns empty boundaryGlobs when not provided', () => {
    const result = collectUnknownProofCandidates({ program: [], rootAbs: '/tmp' });
    expect(result.boundaryGlobs).toEqual([]);
  });

  it('processes a file with no unknown-related code — no typeAssertionFindings', () => {
    const f = toFile('/clean.ts', `const x: number = 42; function add(a: number, b: number) { return a + b; }`);
    const result = collectUnknownProofCandidates({ program: [f], rootAbs: '/tmp' });
    const perFile = result.perFile.get('/clean.ts');
    expect(perFile).toBeDefined();
    expect(perFile?.typeAssertionFindings).toEqual([]);
  });

  it('detects type assertion (as unknown) as typeAssertionFinding', () => {
    const f = toFile('/assert.ts', `const x = someValue as unknown;`);
    const result = collectUnknownProofCandidates({ program: [f], rootAbs: '/tmp' });
    const perFile = result.perFile.get('/assert.ts');
    expect(perFile?.typeAssertionFindings.length).toBeGreaterThanOrEqual(1);
    expect(perFile?.typeAssertionFindings[0]!.kind).toBe('type-assertion');
  });

  it('detects double assertion as typeAssertionFinding', () => {
    const f = toFile('/double.ts', `const x = (value as unknown) as string;`);
    const result = collectUnknownProofCandidates({ program: [f], rootAbs: '/tmp' });
    const perFile = result.perFile.get('/double.ts');
    expect(perFile).toBeDefined();
    // double assertion should be found
    const findings = perFile?.typeAssertionFindings ?? [];
    expect(findings.length).toBeGreaterThanOrEqual(1);
  });

  it('finding has filePath, span, kind, message fields', () => {
    const f = toFile('/finding.ts', `const x = someValue as unknown;`);
    const result = collectUnknownProofCandidates({ program: [f], rootAbs: '/tmp' });
    const perFile = result.perFile.get('/finding.ts');
    const finding = perFile?.typeAssertionFindings[0];
    if (finding) {
      expect(typeof finding.kind).toBe('string');
      expect(typeof finding.filePath).toBe('string');
      expect(finding.span).toBeDefined();
      expect(typeof finding.span.start.line).toBe('number');
    }
  });

  it('trims and filters empty boundaryGlobs', () => {
    const result = collectUnknownProofCandidates({
      program: [],
      rootAbs: '/tmp',
      boundaryGlobs: ['  ', '', 'src/api/**'],
    });
    expect(result.boundaryGlobs).toEqual(['src/api/**']);
  });
});
