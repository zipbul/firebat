/**
 * Cross-feature integration test.
 *
 * Verifies that multiple feature analyzers can run on the same source file
 * without interference or crashes. Each analyzer must produce a well-formed
 * result independently.
 */
import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../../src/engine/parse-source';
import type { ParsedFile } from '../../../src/engine/types';
import { analyzeEarlyReturn } from '../../../src/features/early-return';
import { analyzeExceptionHygiene } from '../../../src/features/exception-hygiene';
import { detectExactDuplicates } from '../../../src/features/exact-duplicates';
import { analyzeNesting } from '../../../src/features/nesting';
import { analyzeNoop } from '../../../src/features/noop';

const SOURCE = `
import { readFileSync } from 'node:fs';

export function loadConfig(path: string | null): Record<string, unknown> {
  if (!path) {
    return {};
  }

  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function processItems(items: readonly string[]): string[] {
  if (items.length === 0) {
    return [];
  }

  const result: string[] = [];

  for (const item of items) {
    if (item.trim().length === 0) {
      continue;
    }

    result.push(item.toUpperCase());
  }

  return result;
}

export function noop(): void {}

export function deepNested(x: number): string {
  if (x > 0) {
    if (x > 10) {
      if (x > 100) {
        return 'huge';
      }

      return 'big';
    }

    return 'small';
  }

  return 'zero';
}
`;

const buildProgram = (source: string): ParsedFile[] => {
  return [parseSource('/virtual/cross-feature.ts', source)];
};

describe('cross-feature integration', () => {
  it('should run all analyzers on the same source without crashes', () => {
    // Arrange
    const program = buildProgram(SOURCE);

    // Act
    const earlyReturn = analyzeEarlyReturn(program);
    const exceptionHygiene = analyzeExceptionHygiene(program);
    const duplicates = detectExactDuplicates([...program], 5);
    const nesting = analyzeNesting(program);
    const noops = analyzeNoop(program);

    // Assert — each returns a well-formed array
    expect(Array.isArray(earlyReturn)).toBe(true);
    expect(Array.isArray(exceptionHygiene)).toBe(true);
    expect(Array.isArray(duplicates)).toBe(true);
    expect(Array.isArray(nesting)).toBe(true);
    expect(Array.isArray(noops)).toBe(true);
  });

  it('should produce findings from multiple analyzers on the same file', () => {
    // Arrange
    const program = buildProgram(SOURCE);

    // Act
    const earlyReturn = analyzeEarlyReturn(program);
    const nesting = analyzeNesting(program);
    const noops = analyzeNoop(program);

    // Assert — at least some analyzers find issues in this code
    const totalFindings = earlyReturn.length + nesting.length + noops.length;

    expect(totalFindings).toBeGreaterThanOrEqual(1);
  });

  it('should produce consistent results on repeated runs', () => {
    // Arrange
    const program = buildProgram(SOURCE);

    // Act — run twice
    const run1 = analyzeEarlyReturn(program);
    const run2 = analyzeEarlyReturn(program);

    // Assert — idempotent
    expect(run1).toEqual(run2);
  });
});
