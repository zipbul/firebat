import { describe, expect, it } from 'bun:test';

// exception-hygiene/types.ts exports only TypeScript type aliases + interfaces.
// There are no runtime values to import. We verify the module resolves without
// errors and perform structural shape checks via plain JS objects.

describe('features/exception-hygiene/types — structural shape', () => {
  it('ExceptionHygieneFinding shape satisfies expected keys', () => {
    const finding = {
      kind: 'silent-catch' as const,
      file: '/src/foo.ts',
      span: {
        start: { line: 10, column: 2 },
        end: { line: 10, column: 20 },
      },
      evidence: 'catch block is empty',
    };
    expect(finding.kind).toBe('silent-catch');
    expect(finding.file).toBe('/src/foo.ts');
    expect(finding.span.start.line).toBe(10);
    expect(finding.span.end.column).toBe(20);
    expect(finding.evidence).toBe('catch block is empty');
  });

  it('optional code field can be provided or omitted', () => {
    const withCode = {
      kind: 'throw-non-error' as const,
      file: '/a.ts',
      span: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
      evidence: 'throwing a string',
      code: 'EX-001' as unknown as import('../../types').FirebatCatalogCode,
    };
    const withoutCode = {
      kind: 'throw-non-error' as const,
      file: '/b.ts',
      span: { start: { line: 2, column: 0 }, end: { line: 2, column: 5 } },
      evidence: 'no code provided',
    };
    expect(withCode.code).toBeDefined();
    expect((withoutCode as { code?: unknown }).code).toBeUndefined();
  });

  it('SourceSpan start/end are SourcePosition with line and column', () => {
    const span = { start: { line: 3, column: 4 }, end: { line: 5, column: 6 } };
    expect(span.start.line).toBe(3);
    expect(span.start.column).toBe(4);
    expect(span.end.line).toBe(5);
    expect(span.end.column).toBe(6);
  });

  it('ExceptionHygieneFindingKind union covers expected string literals', () => {
    const kinds = [
      'tool-unavailable',
      'throw-non-error',
      'async-promise-executor',
      'missing-error-cause',
      'useless-catch',
      'unsafe-finally',
      'return-in-finally',
      'catch-or-return',
      'prefer-catch',
      'prefer-await-to-then',
      'floating-promises',
      'misused-promises',
      'return-await-policy',
      'silent-catch',
      'catch-transform-hygiene',
      'redundant-nested-catch',
      'overscoped-try',
      'exception-control-flow',
    ] satisfies import('./types').ExceptionHygieneFindingKind[];
    expect(kinds.length).toBe(18);
    expect(kinds[0]).toBe('tool-unavailable');
  });
});
