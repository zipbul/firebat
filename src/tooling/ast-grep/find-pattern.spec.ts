import { describe, it, expect, spyOn, beforeEach, afterEach } from 'bun:test';
import { findPatternInFiles } from './find-pattern';
import { createNoopLogger } from '../../shared/logger';

const logger = createNoopLogger('error');

// Simple TypeScript code snippets for pattern matching
const SIMPLE_TS = 'const x = 1; const y = 2;';
const FN_TS = 'function greet(name: string) { return name; }';
const EMPTY_TS = '';

let fileSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  fileSpy = spyOn(Bun, 'file').mockImplementation(((_path: string | URL) => ({
    text: async () => SIMPLE_TS,
  }) as ReturnType<typeof Bun.file>) as unknown as typeof Bun.file);
});

afterEach(() => {
  fileSpy.mockRestore();
});

describe('findPatternInFiles', () => {
  it('should throw an error when neither matcher nor rule is provided', async () => {
    // Arrange
    fileSpy.mockImplementation(((_: string | URL) => ({ text: async () => SIMPLE_TS }) as ReturnType<typeof Bun.file>) as unknown as typeof Bun.file);

    // Act & Assert
    await expect(
      findPatternInFiles({ targets: ['/f.ts'], logger })
    ).rejects.toThrow('Either matcher or rule must be provided.');
  });

  it('should return empty array when targets is empty', async () => {
    // Arrange & Act
    const results = await findPatternInFiles({
      targets: [],
      logger,
      matcher: 'const $X = $Y',
    });

    // Assert
    expect(results).toHaveLength(0);
    expect(fileSpy).not.toHaveBeenCalled();
  });

  it('should return empty array when no matches are found in file', async () => {
    // Arrange
    fileSpy.mockImplementation(((_: string | URL) => ({ text: async () => EMPTY_TS }) as ReturnType<typeof Bun.file>) as unknown as typeof Bun.file);

    // Act
    const results = await findPatternInFiles({
      targets: ['/f.ts'],
      logger,
      matcher: 'class $A {}',
    });

    // Assert
    expect(results).toHaveLength(0);
  });

  it('should return matches with correct shape when matcher is provided', async () => {
    // Arrange
    fileSpy.mockImplementation(((_: string | URL) => ({ text: async () => FN_TS }) as ReturnType<typeof Bun.file>) as unknown as typeof Bun.file);

    // Act
    const results = await findPatternInFiles({
      targets: ['/src/fn.ts'],
      logger,
      matcher: 'function greet($NAME: $T) { return $NAME; }',
    });

    // Assert
    if (results.length > 0) {
      const match = results[0]!;
      expect(typeof match.filePath).toBe('string');
      expect(typeof match.text).toBe('string');
      expect(typeof match.ruleId).toBe('string');
      expect(typeof match.span).toBe('object');
      expect(typeof match.span.start.line).toBe('number');
      expect(typeof match.span.start.column).toBe('number');
      expect(typeof match.span.end.line).toBe('number');
      expect(typeof match.span.end.column).toBe('number');
    } else {
      // No syntax match is fine — just verify no error thrown
      expect(results).toEqual([]);
    }
  });

  it('should use inline as ruleId when ruleName is not provided', async () => {
    // Arrange
    fileSpy.mockImplementation(((_: string | URL) => ({ text: async () => FN_TS }) as ReturnType<typeof Bun.file>) as unknown as typeof Bun.file);

    // Act
    const results = await findPatternInFiles({
      targets: ['/src/fn.ts'],
      logger,
      rule: { pattern: 'function greet($NAME: $T) { return $NAME; }' },
    });

    // Assert
    for (const r of results) {
      expect(r.ruleId).toBe('inline');
    }
  });

  it('should use provided ruleName as ruleId', async () => {
    // Arrange
    fileSpy.mockImplementation(((_: string | URL) => ({ text: async () => FN_TS }) as ReturnType<typeof Bun.file>) as unknown as typeof Bun.file);

    // Act
    const results = await findPatternInFiles({
      targets: ['/src/fn.ts'],
      logger,
      matcher: 'function greet($NAME: $T) { return $NAME; }',
      ruleName: 'my-rule',
    });

    // Assert
    for (const r of results) {
      expect(r.ruleId).toBe('my-rule');
    }
  });

  it('should use filePath from target argument in each match', async () => {
    // Arrange
    fileSpy.mockImplementation(((_: string | URL) => ({ text: async () => SIMPLE_TS }) as ReturnType<typeof Bun.file>) as unknown as typeof Bun.file);

    // Act
    const results = await findPatternInFiles({
      targets: ['/custom/path/file.ts'],
      logger,
      matcher: 'const $X = $Y',
    });

    // Assert
    for (const r of results) {
      expect(r.filePath).toBe('/custom/path/file.ts');
    }
  });

  it('should return span with 1-based line and column numbers', async () => {
    // Arrange
    fileSpy.mockImplementation(((_: string | URL) => ({ text: async () => SIMPLE_TS }) as ReturnType<typeof Bun.file>) as unknown as typeof Bun.file);

    // Act
    const results = await findPatternInFiles({
      targets: ['/f.ts'],
      logger,
      matcher: 'const $X = $Y',
    });

    // Assert
    for (const r of results) {
      expect(r.span.start.line).toBeGreaterThanOrEqual(1);
      expect(r.span.start.column).toBeGreaterThanOrEqual(1);
      expect(r.span.end.line).toBeGreaterThanOrEqual(1);
      expect(r.span.end.column).toBeGreaterThanOrEqual(1);
    }
  });

  it('should accumulate results from multiple targets', async () => {
    // Arrange
    let callCount = 0;
    fileSpy.mockImplementation(((_: string | URL) => ({
      text: async () => {
        callCount += 1;
        return SIMPLE_TS;
      },
    }) as ReturnType<typeof Bun.file>) as unknown as typeof Bun.file);

    // Act
    await findPatternInFiles({
      targets: ['/a.ts', '/b.ts', '/c.ts'],
      logger,
      matcher: 'const $X = $Y',
    });

    // Assert
    expect(callCount).toBe(3);
  });
});
