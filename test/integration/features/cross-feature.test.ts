import type { Gildash } from '@zipbul/gildash';

/**
 * Cross-feature integration test.
 *
 * Verifies that multiple feature analyzers can run on the same source file
 * without interference or crashes. Each analyzer must produce a well-formed
 * result independently.
 */
import { describe, expect, it } from 'bun:test';

import type { ParsedFile } from '../../../src/test-api';

import { parseSource } from '../../../src/test-api';
import { analyzeEarlyReturn } from '../../../src/test-api';
import { analyzeErrorFlow } from '../../../src/test-api';
import { analyzeDuplicates } from '../../../src/test-api';
import { analyzeNesting } from '../../../src/test-api';

const noopGildash = {
  isTypeAssignableToType: () => null,
  getResolvedTypesAtPositions: () => new Map(),
  isTypeAssignableToTypeAtPositions: () => new Map(),
} as unknown as Gildash;
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
  it('should run all analyzers on the same source without crashes', async () => {
    // Arrange
    const program = buildProgram(SOURCE);
    // Act
    const earlyReturn = analyzeEarlyReturn(program);
    const errorFlow = await analyzeErrorFlow(program, { gildash: noopGildash });
    const duplicates = analyzeDuplicates([...program], { minSize: 5 });
    const nesting = analyzeNesting(program);

    // Assert — each returns a well-formed array
    expect(Array.isArray(earlyReturn)).toBe(true);
    expect(Array.isArray(errorFlow)).toBe(true);
    expect(Array.isArray(duplicates)).toBe(true);
    expect(Array.isArray(nesting)).toBe(true);
  });

  it('should produce findings from BOTH early-return and nesting on the same file', () => {
    // Arrange — SOURCE has `loadConfig` (wrapping-if) and `deepNested` (depth-3 nesting),
    // so both analyzers must independently report at least one finding. The previous
    // assertion summed both lengths so a complete failure in one analyzer was hidden
    // by the other.
    const program = buildProgram(SOURCE);
    // Act
    const earlyReturn = analyzeEarlyReturn(program);
    const nesting = analyzeNesting(program);

    // Assert — each analyzer must find something on its own.
    expect(earlyReturn.length).toBeGreaterThanOrEqual(1);
    expect(nesting.length).toBeGreaterThanOrEqual(1);
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
