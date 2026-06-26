import { describe, expect, it } from 'bun:test';

import { __testing__, createEmptyFormat } from './analyzer';

/** Assert `parseOxfmtFiles(raw)` yields an empty array. */
const expectParseEmpty = (raw: unknown): void => {
  expect(__testing__.parseOxfmtFiles(raw)).toEqual([]);
};

describe('format/analyzer', () => {
  describe('createEmptyFormat', () => {
    it('should return an empty array when called', () => {
      // Arrange
      // Act
      const result = createEmptyFormat();

      // Assert
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([]);
    });
  });

  describe('parseOxfmtFiles', () => {
    it('should return an empty array when stdout is not a string', () => {
      // Arrange
      const raw: unknown = { ok: true };
      // Act
      expectParseEmpty(raw);
    });

    it('should return an empty array when stdout is empty', () => {
      // Arrange
      const raw = '   \n\n  ';
      // Act
      expectParseEmpty(raw);
    });

    it('should return only path-like lines when stdout contains mixed content', () => {
      // Arrange
      const raw = ['Checking formatting...', 'src/a.ts', 'not a path', 'src/components/Button.tsx', 'file.json', 'Done'].join(
        '\n',
      );
      // Act
      const files = __testing__.parseOxfmtFiles(raw);

      // Assert
      expect(files).toEqual(['src/a.ts', 'src/components/Button.tsx', 'file.json']);
    });

    it('should treat lines with slashes as paths even without extensions', () => {
      // Arrange
      const raw = ['src/app', 'README', 'packages/core/src/index'].join('\n');
      // Act
      const files = __testing__.parseOxfmtFiles(raw);

      // Assert
      expect(files).toEqual(['src/app', 'packages/core/src/index']);
    });
  });
});
