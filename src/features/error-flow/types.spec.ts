import { describe, expect, it } from 'bun:test';

// error-flow/types.ts exports only TypeScript type aliases + interfaces.
// There are no runtime values to import. We verify the module resolves without
// errors and perform structural shape checks via plain JS objects.

interface PlainPosition {
  line: number;
  column: number;
}

interface PlainSpan {
  start: PlainPosition;
  end: PlainPosition;
}

interface PlainFinding {
  kind: string;
  file: string;
  span: PlainSpan;
  evidence: string;
}

// Asserts a span's four coordinates in one place so the SourceSpan/SourcePosition shape has a single
// expression across the structural-shape tests below.
const expectSpan = (span: PlainSpan, startLine: number, startColumn: number, endLine: number, endColumn: number) => {
  expect(span.start.line).toBe(startLine);
  expect(span.start.column).toBe(startColumn);
  expect(span.end.line).toBe(endLine);
  expect(span.end.column).toBe(endColumn);
};

// Builds the ErrorFlowFinding-shaped object in one place so its structural shape has a single
// expression; tests vary only the field values (and `withCode` adds the optional `code`).
const makeFinding = (kind: string, file: string, span: PlainSpan, evidence: string): PlainFinding => ({
  kind,
  file,
  span,
  evidence,
});

describe('features/error-flow/types — structural shape', () => {
  it('ErrorFlowFinding shape satisfies expected keys', () => {
    const finding = makeFinding(
      'empty-catch',
      '/src/foo.ts',
      { start: { line: 10, column: 2 }, end: { line: 10, column: 20 } },
      'empty catch swallows the error',
    );

    expect(finding.kind).toBe('empty-catch');
    expect(finding.file).toBe('/src/foo.ts');
    expectSpan(finding.span, 10, 2, 10, 20);
    expect(finding.evidence).toBe('empty catch swallows the error');
  });

  it('optional code field can be provided or omitted', () => {
    const withCode = {
      ...makeFinding(
        'throw-non-error',
        '/a.ts',
        { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
        'throwing a string',
      ),
      code: 'EX-001' as unknown as import('../../types').FirebatCatalogCode,
    };
    const withoutCode = makeFinding(
      'throw-non-error',
      '/b.ts',
      { start: { line: 2, column: 0 }, end: { line: 2, column: 5 } },
      'no code provided',
    );

    expect(withCode.code).toBeDefined();
    expect((withoutCode as { code?: unknown }).code).toBeUndefined();
  });

  it('SourceSpan start/end are SourcePosition with line and column', () => {
    const span = { start: { line: 3, column: 4 }, end: { line: 5, column: 6 } };

    expectSpan(span, 3, 4, 5, 6);
  });

  it('ErrorFlowFindingKind union covers expected string literals', () => {
    const kinds = [
      'tool-unavailable',
      'throw-non-error',
      'promise-constructor-hygiene',
      'missing-error-cause',
      'unsafe-finally',
      'return-await-in-try',
      'floating-promises',
      'catch-or-return',
      'misused-promises',
      'unobserved-variable',
      'no-callback-in-promise',
      'empty-catch',
    ] satisfies import('./types').ErrorFlowFindingKind[];

    expect(kinds.length).toBe(12);
    expect(kinds[0]).toBe('tool-unavailable');
  });
});
