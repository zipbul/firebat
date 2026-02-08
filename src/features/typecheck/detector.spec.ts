import { describe, expect, it } from 'bun:test';

import type { TypecheckItem } from '../../types';

import { convertPublishDiagnosticsToTypecheckItems } from './detector';

describe('detector', () => {
  it('should convert LSP publishDiagnostics items into typecheck items', () => {
    // Arrange
    const uri = 'file:///repo/src/a.ts';
    const params = {
      uri,
      diagnostics: [
        {
          range: {
            start: { line: 2, character: 4 },
            end: { line: 2, character: 10 },
          },
          severity: 1,
          code: 'TS2322',
          message: "Type 'string' is not assignable to type 'number'.",
          source: 'tsgo',
        },
        {
          range: {
            start: { line: 9, character: 0 },
            end: { line: 9, character: 6 },
          },
          severity: 2,
          code: 'TS6133',
          message: "'unused' is declared but its value is never read.",
          source: 'tsgo',
        },
      ],
    };
    // Act
    const items = convertPublishDiagnosticsToTypecheckItems(params);

    // Assert
    expect(items).toHaveLength(2);

    const expectedError = {
      severity: 'error',
      code: 'TS2322',
      message: "Type 'string' is not assignable to type 'number'.",
      filePath: '/repo/src/a.ts',
      span: {
        start: { line: 3, column: 5 },
        end: { line: 3, column: 11 },
      },
    } satisfies Partial<TypecheckItem>;
    const expectedWarning = {
      severity: 'warning',
      code: 'TS6133',
      message: "'unused' is declared but its value is never read.",
      filePath: '/repo/src/a.ts',
      span: {
        start: { line: 10, column: 1 },
        end: { line: 10, column: 7 },
      },
    } satisfies Partial<TypecheckItem>;

    expect(items[0]).toMatchObject(expectedError);
    expect(items[1]).toMatchObject(expectedWarning);
  });
});
