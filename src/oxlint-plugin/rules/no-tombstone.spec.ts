import { describe, expect, it } from 'bun:test';

import type { AstNode } from '../types';

import { setupRule } from '../../../test/integration/oxlint-plugin/utils/rule-test-kit';
import { noTombstoneRule } from './no-tombstone';

describe('no-tombstone', () => {
  it.each([
    ['file is empty', ''],
    ['file is whitespace-only', '   \n\n\t\n'],
    ['file contains only comments', '// just a comment\n/* and another */\n'],
    ['comments use CRLF newlines', '// just a comment\r\n/* and another */\r\n'],
    ['file only contains export {}', 'export {};\n'],
    ['export {} has comments or whitespace', '  /* header */\nexport {}\n// footer\n'],
  ])('should report when %s', (_label, text) => {
    // Arrange
    const { visitor, reports } = setupRule(noTombstoneRule, { text });
    const programNode: AstNode = { type: 'Program', body: [] };

    // Act
    visitor.Program(programNode);

    // Assert
    expect(reports.length).toBe(1);
    expect(reports[0]?.messageId).toBe('tombstone');
    expect(reports[0]?.node?.type).toBe('Program');
  });

  it.each([
    ['file has content', 'export const value = 1;\n'],
    ['export has bindings', 'export { value };\n'],
    ['file contains URL string', 'export const url = "http://example.com";\n'],
  ])('should skip report when %s', (_label, text) => {
    // Arrange
    const { visitor, reports } = setupRule(noTombstoneRule, { text });
    const programNode: AstNode = { type: 'Program', body: [{ type: 'ExportNamedDeclaration' }] };

    // Act
    visitor.Program(programNode);

    // Assert
    expect(reports.length).toBe(0);
  });
});
