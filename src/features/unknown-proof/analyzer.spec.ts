import { describe, expect, it } from 'bun:test';

import type { ParsedFile } from '../../engine/types';

import { parseSource } from '../../engine/ast/parse-source';
import { analyzeUnknownProof, createEmptyUnknownProof } from './analyzer';

const toFile = (filePath: string, code: string): ParsedFile => parseSource(filePath, code) as ParsedFile;

describe('features/unknown-proof/analyzer — createEmptyUnknownProof', () => {
  it('createEmptyUnknownProof - returns empty array', () => {
    expect(createEmptyUnknownProof()).toEqual([]);
  });
});

describe('features/unknown-proof/analyzer — analyzeUnknownProof', () => {
  it('analyzeUnknownProof - empty program - returns empty array', () => {
    const result = analyzeUnknownProof([]);

    expect(result).toEqual([]);
  });

  it('analyzeUnknownProof - as any cast - returns any-cast finding', () => {
    const f = toFile('/any-cast.ts', `const x = response as any;`);
    // no gildash -> PartialResultError, but expression findings are still returned
    let result: ReadonlyArray<{ kind: string }> = [];

    try {
      result = analyzeUnknownProof([f], { rootAbs: '/tmp' });
    } catch (e: any) {
      result = e.partial ?? [];
    }

    const anyCastFindings = result.filter(r => r.kind === 'any-cast');

    expect(anyCastFindings.length).toBe(1);
  });

  it('analyzeUnknownProof - double cast - returns double-cast finding', () => {
    const f = toFile('/double-cast.ts', `const x = data as unknown as User;`);
    let result: ReadonlyArray<{ kind: string }> = [];

    try {
      result = analyzeUnknownProof([f], { rootAbs: '/tmp' });
    } catch (e: any) {
      result = e.partial ?? [];
    }

    const doubleCastFindings = result.filter(r => r.kind === 'double-cast');

    expect(doubleCastFindings.length).toBe(1);
  });

  it('analyzeUnknownProof - code without any casts - throws PartialResultError when no gildash', () => {
    const f = toFile('/no-cast.ts', `const x = value as string;`);

    // Has binding candidates but no gildash -> PartialResultError
    expect(() => analyzeUnknownProof([f], { rootAbs: '/tmp' })).toThrow();
  });

  it('analyzeUnknownProof - no binding candidates - returns expression findings only', () => {
    // Empty program has no binding candidates
    const result = analyzeUnknownProof([]);

    expect(result).toEqual([]);
  });
});
