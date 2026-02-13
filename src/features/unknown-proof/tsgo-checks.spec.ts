import { describe, expect, it } from 'bun:test';

import { __test__ } from './tsgo-checks';

const { pickTypeSnippetFromHoverText, shouldFlagUnknownOrAny } = __test__;

describe('unknown-proof/tsgo-checks', () => {
  describe('pickTypeSnippetFromHoverText', () => {
    it('should extract type snippet from a single code block', () => {
      const text = '```typescript\nconst x: string\n```';
      const result = pickTypeSnippetFromHoverText(text);

      expect(result).toBe('const x: string');
    });

    it('should prefer type declaration block when multiple code blocks exist', () => {
      const text = '```\nsome docs\n```\n\n```typescript\nconst x: unknown\n```';
      const result = pickTypeSnippetFromHoverText(text);

      expect(result).toBe('const x: unknown');
    });

    it('should handle multiline type by joining all lines', () => {
      const text = '```typescript\nconst result: {\n    data: unknown;\n    error: string;\n}\n```';
      const result = pickTypeSnippetFromHoverText(text);

      expect(result).toContain('data: unknown');
      expect(result).toContain('error: string');
    });

    it('should return empty string for empty text', () => {
      expect(pickTypeSnippetFromHoverText('')).toBe('');
      expect(pickTypeSnippetFromHoverText('   ')).toBe('');
    });

    it('should fall back to raw text when no code blocks exist', () => {
      const text = 'const x: number';
      const result = pickTypeSnippetFromHoverText(text);

      expect(result).toBe('const x: number');
    });
  });

  describe('shouldFlagUnknownOrAny', () => {
    it('should detect unknown in type portion only (not variable name)', () => {
      const text = '```typescript\nconst isUnknownType: boolean\n```';
      const result = shouldFlagUnknownOrAny(text);

      expect(result.unknown).toBe(false);
      expect(result.any).toBe(false);
    });

    it('should detect unknown in type portion', () => {
      const text = '```typescript\nconst x: unknown\n```';
      const result = shouldFlagUnknownOrAny(text);

      expect(result.unknown).toBe(true);
    });

    it('should detect any in type portion', () => {
      const text = '```typescript\nconst x: any\n```';
      const result = shouldFlagUnknownOrAny(text);

      expect(result.any).toBe(true);
    });

    it('should not flag any in variable name', () => {
      const text = '```typescript\nconst anyValue: string\n```';
      const result = shouldFlagUnknownOrAny(text);

      expect(result.any).toBe(false);
    });

    it('should detect unknown in multiline type', () => {
      const text = '```typescript\nconst result: {\n    data: unknown;\n    error: string;\n}\n```';
      const result = shouldFlagUnknownOrAny(text);

      expect(result.unknown).toBe(true);
    });

    it('should detect unknown[] array type', () => {
      const text = '```typescript\nconst items: unknown[]\n```';
      const result = shouldFlagUnknownOrAny(text);

      expect(result.unknown).toBe(true);
    });
  });
});
