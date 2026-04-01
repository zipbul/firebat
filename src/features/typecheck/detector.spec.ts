import type { SemanticDiagnostic } from '@zipbul/gildash';

import { describe, expect, it, mock } from 'bun:test';

describe('features/typecheck/detector', () => {
  it('createEmptyTypecheck - returns empty array', async () => {
    const { createEmptyTypecheck } = await import('./detector');
    const empty = createEmptyTypecheck();

    expect(Array.isArray(empty)).toBe(true);
    expect(empty).toHaveLength(0);
  });

  it('analyzeTypecheck - throws when tsconfig.json not found', async () => {
    const { analyzeTypecheck } = await import('./detector');

    await expect(analyzeTypecheck([], { rootAbs: '/nonexistent-dir' })).rejects.toThrow('tsconfig.json not found');
  });

  it('analyzeTypecheck - gildash provided, error diagnostic - maps to TypecheckItem with 1-based column', async () => {
    const { analyzeTypecheck } = await import('./detector');
    const fakeDiag: SemanticDiagnostic = {
      filePath: '/root/src/foo.ts',
      line: 3,
      column: 4, // 0-based → should become 5
      message: "Type 'string' is not assignable to type 'number'.",
      code: 2322,
      category: 'error',
    };
    const fakeGildash = {
      getSemanticDiagnostics: mock((_filePath: string, _opts?: { preEmit?: boolean }) => [fakeDiag]),
    };
    const program = [{ filePath: '/root/src/foo.ts', sourceText: 'const x: number = "hello";' }];
    const result = await analyzeTypecheck(program as any, {
      rootAbs: '/root',
      gildash: fakeGildash as any,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.code).toBe('TS2322');
    expect(result[0]!.severity).toBe('error');
    expect(result[0]!.msg).toBe("Type 'string' is not assignable to type 'number'.");
    expect(result[0]!.file).toBe('src/foo.ts');
    expect(result[0]!.span.start.line).toBe(3);
    expect(result[0]!.span.start.column).toBe(5); // 0-based 4 → 1-based 5
    expect(result[0]!.span.end.line).toBe(3);
    expect(result[0]!.span.end.column).toBe(5); // end == start
  });

  it('analyzeTypecheck - gildash provided, suggestion diagnostic - skipped', async () => {
    const { analyzeTypecheck } = await import('./detector');
    const suggestionDiag: SemanticDiagnostic = {
      filePath: '/root/src/bar.ts',
      line: 1,
      column: 0,
      message: 'Some suggestion',
      code: 9999,
      category: 'suggestion',
    };
    const fakeGildash = {
      getSemanticDiagnostics: mock((_filePath: string, _opts?: { preEmit?: boolean }) => [suggestionDiag]),
    };
    const program = [{ filePath: '/root/src/bar.ts', sourceText: 'const x = 1;' }];
    const result = await analyzeTypecheck(program as any, {
      rootAbs: '/root',
      gildash: fakeGildash as any,
    });

    expect(result).toHaveLength(0);
  });

  it('analyzeTypecheck - gildash provided, warning diagnostic - mapped to error severity', async () => {
    const { analyzeTypecheck } = await import('./detector');
    const warningDiag: SemanticDiagnostic = {
      filePath: '/root/src/baz.ts',
      line: 2,
      column: 0,
      message: 'Some warning',
      code: 6133,
      category: 'warning',
    };
    const fakeGildash = {
      getSemanticDiagnostics: mock((_filePath: string, _opts?: { preEmit?: boolean }) => [warningDiag]),
    };
    const program = [{ filePath: '/root/src/baz.ts', sourceText: 'const unused = 1;' }];
    const result = await analyzeTypecheck(program as any, {
      rootAbs: '/root',
      gildash: fakeGildash as any,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.severity).toBe('error');
  });

  it('analyzeTypecheck - gildash provided - calls getSemanticDiagnostics with preEmit true for each file', async () => {
    const { analyzeTypecheck } = await import('./detector');
    const fakeGetSemanticDiagnostics = mock((_filePath: string, _opts?: { preEmit?: boolean }) => [] as SemanticDiagnostic[]);
    const fakeGildash = { getSemanticDiagnostics: fakeGetSemanticDiagnostics };
    const program = [
      { filePath: '/root/src/a.ts', sourceText: '' },
      { filePath: '/root/src/b.ts', sourceText: '' },
    ];

    await analyzeTypecheck(program as any, {
      rootAbs: '/root',
      gildash: fakeGildash as any,
    });

    expect(fakeGetSemanticDiagnostics).toHaveBeenCalledTimes(2);
    expect(fakeGetSemanticDiagnostics).toHaveBeenCalledWith('/root/src/a.ts', { preEmit: true });
    expect(fakeGetSemanticDiagnostics).toHaveBeenCalledWith('/root/src/b.ts', { preEmit: true });
  });
});
