import { describe, expect, it } from 'bun:test';

import type { TypecheckItem } from '../../types';

import { convertPublishDiagnosticsToTypecheckItems, __test__ } from './detector';

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
        {
          range: {
            start: { line: 12, character: 0 },
            end: { line: 12, character: 1 },
          },
          severity: 3,
          code: 'TS9999',
          message: 'informational',
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
      severity: 'error',
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

  it('should extract diagnostics from pull full report', () => {
    // Arrange
    const raw = {
      kind: 'full',
      items: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          severity: 1,
          message: 'x',
        },
      ],
    };

    // Act
    const items = __test__.pullDiagnosticsToItems(raw);

    // Assert
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ message: 'x' });
  });

  it('should extract diagnostics from pull report items without kind', () => {
    // Arrange
    const raw = {
      items: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          message: 'y',
        },
      ],
    };

    // Act
    const items = __test__.pullDiagnosticsToItems(raw);

    // Assert
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ message: 'y' });
  });
});
