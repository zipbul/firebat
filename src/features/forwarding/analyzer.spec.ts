import { describe, expect, it } from 'bun:test';

import { err } from '@zipbul/result';
import type { Gildash, GildashError, CodeRelation, SymbolSearchResult } from '@zipbul/gildash';

import type { ParsedFile } from '../../engine/types';

import { parseSource } from '../../engine/ast/parse-source';
import { analyzeForwarding } from './analyzer';

/* ------------------------------------------------------------------ */
/*  Mock gildash factory                                               */
/* ------------------------------------------------------------------ */

const createMockGildash = (overrides: {
  searchRelations?: (q: unknown) => CodeRelation[] | ReturnType<typeof err>;
  searchSymbols?: (q: unknown) => SymbolSearchResult[] | ReturnType<typeof err>;
} = {}): Gildash => {
  return {
    searchRelations: overrides.searchRelations ?? (() => []),
    searchSymbols: overrides.searchSymbols ?? (() => []),
  } as unknown as Gildash;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const createProgram = (filePath: string, sourceText: string): ParsedFile[] => {
  return [parseSource(filePath, sourceText)];
};

const findKinds = (findings: Awaited<ReturnType<typeof analyzeForwarding>>, kind: string) => {
  return findings.filter(finding => finding.kind === kind);
};

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('analyzer', () => {
  it('should report a thin wrapper when a function only forwards a call', async () => {
    // Arrange
    const source = [
      'function target(value) {',
      '  return value + 1;',
      '}',
      'function wrapper(value) {',
      '  return target(value);',
      '}',
    ].join('\n');
    const program = createProgram('/virtual/forwarding.ts', source);
    const gildash = createMockGildash();
    // Act
    const analysis = await analyzeForwarding(gildash, program, 0, '/virtual');
    const thinWrappers = findKinds(analysis, 'thin-wrapper');

    // Assert
    expect(thinWrappers.length).toBe(1);
    expect(thinWrappers[0]?.header).toBe('wrapper');
  });

  it('should ignore wrappers when arguments are transformed', async () => {
    // Arrange
    const source = [
      'function target(value) {',
      '  return value + 1;',
      '}',
      'function wrapper(value) {',
      '  return target(value + 1);',
      '}',
    ].join('\n');
    const program = createProgram('/virtual/forwarding-transform.ts', source);
    const gildash = createMockGildash();
    // Act
    const analysis = await analyzeForwarding(gildash, program, 0, '/virtual');
    const thinWrappers = findKinds(analysis, 'thin-wrapper');

    // Assert
    expect(thinWrappers.length).toBe(0);
  });

  it('should report chain depth when it exceeds the max', async () => {
    // Arrange
    const source = [
      'function c(value) {',
      '  return value;',
      '}',
      'function b(value) {',
      '  return c(value);',
      '}',
      'function a(value) {',
      '  return b(value);',
      '}',
    ].join('\n');
    const program = createProgram('/virtual/forwarding-chain.ts', source);
    const gildash = createMockGildash();
    // Act
    const analysis = await analyzeForwarding(gildash, program, 1, '/virtual');
    const chainFindings = findKinds(analysis, 'forward-chain');

    // Assert
    expect(chainFindings.length).toBe(1);
    expect(chainFindings[0]?.header).toBe('a');
  });

  it('should skip chain findings when depth stays within the max', async () => {
    // Arrange
    const source = [
      'function c(value) {',
      '  return value;',
      '}',
      'function b(value) {',
      '  return c(value);',
      '}',
      'function a(value) {',
      '  return b(value);',
      '}',
    ].join('\n');
    const program = createProgram('/virtual/forwarding-depth.ts', source);
    const gildash = createMockGildash();
    // Act
    const analysis = await analyzeForwarding(gildash, program, 2, '/virtual');
    const chainFindings = findKinds(analysis, 'forward-chain');

    // Assert
    expect(chainFindings.length).toBe(0);
  });
});
