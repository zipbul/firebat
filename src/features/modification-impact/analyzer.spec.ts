import { describe, expect, it } from 'bun:test';

import { err } from '@zipbul/result';
import type { Gildash, SymbolSearchResult } from '@zipbul/gildash';

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

const createMockGildash = (overrides: {
  searchSymbols?: (q: unknown) => SymbolSearchResult[] | ReturnType<typeof err>;
  getAffected?: (changedFiles: string[]) => Promise<string[] | ReturnType<typeof err>>;
} = {}): Gildash => {
  return {
    searchSymbols: overrides.searchSymbols ?? (() => []),
    getAffected: overrides.getAffected ?? (async () => []),
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
      getAffected: async (changedFiles: string[]) => {
        if (changedFiles[0]?.includes('src/a.ts')) return ['/p/src/b.ts', '/p/src/c.ts'];
        return [];
      },
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
      getAffected: async (changedFiles: string[]) => {
        if (changedFiles[0]?.includes('src/a.ts')) return ['/p/src/b.ts'];
        return [];
      },
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
      getAffected: async (changedFiles: string[]) => {
        if (changedFiles[0]?.includes('src/application/service.ts')) {
          return ['/p/src/adapters/cli/entry.ts', '/p/src/infrastructure/db.ts'];
        }
        return [];
      },
    });
    // Act
    const result = await analyzeModificationImpact(gildash, files as any, '/p');

    // Assert
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(result[0]?.highRiskCallers)).toBe(true);
    expect((result[0]?.highRiskCallers ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
