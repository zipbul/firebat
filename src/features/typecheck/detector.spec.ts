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

  it('analyzeTypecheck - gildash returns multiple diagnostics across files - sorted by file then line', async () => {
    const { analyzeTypecheck } = await import('./detector');
    const diags: Record<string, SemanticDiagnostic[]> = {
      '/root/src/b.ts': [
        { filePath: '/root/src/b.ts', line: 7, column: 0, message: 'b line 7', code: 1, category: 'error' },
        { filePath: '/root/src/b.ts', line: 2, column: 0, message: 'b line 2', code: 1, category: 'error' },
      ],
      '/root/src/a.ts': [{ filePath: '/root/src/a.ts', line: 5, column: 0, message: 'a line 5', code: 1, category: 'error' }],
    };
    const fakeGildash = {
      getSemanticDiagnostics: mock((filePath: string) => diags[filePath] ?? []),
    };
    const program = [
      { filePath: '/root/src/b.ts', sourceText: '' },
      { filePath: '/root/src/a.ts', sourceText: '' },
    ];
    const result = await analyzeTypecheck(program as any, { rootAbs: '/root', gildash: fakeGildash as any });

    expect(result).toHaveLength(3);
    expect(result.map(r => `${r.file}:${r.span.start.line}`)).toEqual(['src/a.ts:5', 'src/b.ts:2', 'src/b.ts:7']);
  });

  it('analyzeTypecheck - gildash empty file list - returns []', async () => {
    const { analyzeTypecheck } = await import('./detector');
    const fakeGildash = {
      getSemanticDiagnostics: mock(() => [] as SemanticDiagnostic[]),
    };
    const result = await analyzeTypecheck([], { rootAbs: '/root', gildash: fakeGildash as any });

    expect(result).toEqual([]);
  });

  it('analyzeTypecheck - column offset conversion - 0-based input becomes 1-based output for both start and end', async () => {
    const { analyzeTypecheck } = await import('./detector');
    const fakeGildash = {
      getSemanticDiagnostics: mock(
        () =>
          [{ filePath: '/root/src/a.ts', line: 10, column: 0, message: 'col0', code: 1, category: 'error' }] as SemanticDiagnostic[],
      ),
    };
    const result = await analyzeTypecheck(
      [{ filePath: '/root/src/a.ts', sourceText: 'const x = 1;' }] as any,
      { rootAbs: '/root', gildash: fakeGildash as any },
    );

    expect(result).toHaveLength(1);
    expect(result[0]!.span.start.column).toBe(1);
    expect(result[0]!.span.end.column).toBe(1);
    expect(result[0]!.span.start.line).toBe(10);
    expect(result[0]!.span.end.line).toBe(10);
  });

  it('analyzeTypecheck - error and warning diagnostics produced - both included with documented severity policy', async () => {
    const { analyzeTypecheck } = await import('./detector');
    const fakeGildash = {
      getSemanticDiagnostics: mock(
        () =>
          [
            { filePath: '/root/src/a.ts', line: 1, column: 0, message: 'err', code: 2322, category: 'error' },
            { filePath: '/root/src/a.ts', line: 2, column: 0, message: 'warn', code: 6133, category: 'warning' },
          ] as SemanticDiagnostic[],
      ),
    };
    const result = await analyzeTypecheck(
      [{ filePath: '/root/src/a.ts', sourceText: 'const a = 1;\nconst b = 2;' }] as any,
      { rootAbs: '/root', gildash: fakeGildash as any },
    );

    expect(result).toHaveLength(2);
    // Policy: warnings are upgraded to errors (see typecheck/detector.ts:47).
    expect(result.every(r => r.severity === 'error')).toBe(true);
    expect(result.map(r => r.code)).toEqual(['TS2322', 'TS6133']);
  });
});
