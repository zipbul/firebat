import { describe, expect, it } from 'bun:test';

import { err } from '@zipbul/result';
import type { Gildash, CodeRelation, SymbolSearchResult } from '@zipbul/gildash';

import { parseSource } from '../../engine/ast/parse-source';
import { analyzeModificationImpact, createEmptyModificationImpact } from './analyzer';

/* ------------------------------------------------------------------ */
/*  Mock gildash factory                                               */
/* ------------------------------------------------------------------ */

const mkSymbol = (
  id: number,
  filePath: string,
  name: string,
): SymbolSearchResult => ({
  id,
  filePath,
  kind: 'function' as SymbolSearchResult['kind'],
  name,
  span: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
  isExported: true,
  signature: null,
  fingerprint: null,
  detail: {},
});

const mkImport = (
  srcFilePath: string,
  dstFilePath: string,
): CodeRelation => ({
  type: 'imports',
  srcFilePath,
  srcSymbolName: null,
  dstFilePath,
  dstSymbolName: null,
} as CodeRelation);

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

const file = (relPath: string, sourceText: string) => parseSource(`/p/${relPath}`, sourceText);

const fileWithErrors = (relPath: string, sourceText: string) => {
  const parsed = file(relPath, sourceText);

  return { ...parsed, errors: [{ message: 'synthetic' }] as any };
};

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('modification-impact/analyzer', () => {
  it('should return empty result when files are empty', async () => {
    // Arrange
    const files: any[] = [];
    const gildash = createMockGildash();
    // Act
    const result = await analyzeModificationImpact(gildash, files as any, '/p');

    // Assert
    expect(result).toEqual(createEmptyModificationImpact());
  });

  it('should ignore files with parse errors', async () => {
    // Arrange
    const files = [fileWithErrors('src/a.ts', 'export function f() { return 1; }'), file('src/b.ts', 'export const b = 1;')];
    const gildash = createMockGildash({
      searchSymbols: () => [mkSymbol(1, 'src/a.ts', 'f')],
      searchRelations: () => [],
    });
    // Act
    const result = await analyzeModificationImpact(gildash, files as any, '/p');

    // Assert
    expect(result.length).toBe(0);
  });

  it('should report exported symbols with impact radius >= 2', async () => {
    // Arrange
    const files = [
      file('src/a.ts', 'export function f() { return 1; }'),
      file('src/b.ts', 'import { f } from "./a"; export const b = () => f();'),
      file('src/c.ts', 'import { f } from "./a"; export const c = () => f();'),
    ];
    const gildash = createMockGildash({
      searchSymbols: () => [
        mkSymbol(1, 'src/a.ts', 'f'),
        mkSymbol(2, 'src/b.ts', 'b'),
        mkSymbol(3, 'src/c.ts', 'c'),
      ],
      searchRelations: () => [
        mkImport('src/b.ts', 'src/a.ts'),
        mkImport('src/c.ts', 'src/a.ts'),
      ],
    });
    // Act
    const result = await analyzeModificationImpact(gildash, files as any, '/p');

    // Assert
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]?.kind).toBe('modification-impact');
    expect(typeof result[0]?.impactRadius).toBe('number');
    expect(result[0]?.impactRadius).toBeGreaterThanOrEqual(2);
  });

  it('should not report when impact radius is below threshold', async () => {
    // Arrange
    const files = [
      file('src/a.ts', 'export function f() { return 1; }'),
      file('src/b.ts', 'import { f } from "./a"; export const b = () => f();'),
    ];
    const gildash = createMockGildash({
      searchSymbols: () => [
        mkSymbol(1, 'src/a.ts', 'f'),
        mkSymbol(2, 'src/b.ts', 'b'),
      ],
      searchRelations: () => [
        mkImport('src/b.ts', 'src/a.ts'),
      ],
    });
    // Act
    const result = await analyzeModificationImpact(gildash, files as any, '/p');

    // Assert
    expect(result.length).toBe(0);
  });

  it('should populate highRiskCallers when application exports are used from adapters/infrastructure', async () => {
    // Arrange
    const files = [
      file('src/application/service.ts', 'export function f() { return 1; }'),
      file('src/adapters/cli/entry.ts', 'import { f } from "../../application/service"; export const run = () => f();'),
      file('src/infrastructure/db.ts', 'import { f } from "../application/service"; export const db = () => f();'),
    ];
    const gildash = createMockGildash({
      searchSymbols: () => [
        mkSymbol(1, 'src/application/service.ts', 'f'),
        mkSymbol(2, 'src/adapters/cli/entry.ts', 'run'),
        mkSymbol(3, 'src/infrastructure/db.ts', 'db'),
      ],
      searchRelations: () => [
        mkImport('src/adapters/cli/entry.ts', 'src/application/service.ts'),
        mkImport('src/infrastructure/db.ts', 'src/application/service.ts'),
      ],
    });
    // Act
    const result = await analyzeModificationImpact(gildash, files as any, '/p');

    // Assert
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(result[0]?.highRiskCallers)).toBe(true);
    expect((result[0]?.highRiskCallers ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
