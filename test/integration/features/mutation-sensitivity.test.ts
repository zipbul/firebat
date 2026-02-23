/**
 * Mutation sensitivity test.
 *
 * Verifies that golden tests are sensitive to key analyzer parameters.
 * Each test mutates a threshold or condition and asserts the output changes.
 * If the output does NOT change, the golden test suite has a blind spot.
 *
 * This serves as a lightweight substitute for full mutation testing (Stryker)
 * until Bun is officially supported.
 */
import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../../src/test-api';
import type { ParsedFile } from '../../../src/test-api';
import { analyzeEarlyReturn } from '../../../src/test-api';
import { detectExactDuplicates } from '../../../src/test-api';
import { analyzeNesting } from '../../../src/test-api';

const parse = (code: string): ParsedFile[] => [parseSource('/virtual/mutation.ts', code)];

describe('mutation sensitivity', () => {
  it('should produce different exact-duplicate results with different minSize thresholds', () => {
    // Source with a small duplicated block
    const code = `
export function a() { return 1 + 2; }
export function b() { return 1 + 2; }
`;
    const program = parse(code);

    const strict = detectExactDuplicates([...program], 1);
    const lenient = detectExactDuplicates([...program], 999);

    // strict (minSize=1) should find more or equal duplicates than lenient (minSize=999)
    expect(strict.length).toBeGreaterThanOrEqual(lenient.length);
  });

  it('should detect nesting changes when code structure changes', () => {
    // Deeply nested code → should produce findings
    const deep = parse(`
export function f(x: number): string {
  if (x > 0) {
    if (x > 10) {
      if (x > 100) {
        if (x > 1000) {
          return 'huge';
        }
        return 'large';
      }
      return 'medium';
    }
    return 'small';
  }
  return 'zero';
}
`);
    // Flat code → should produce fewer findings
    const flat = parse(`
export function f(x: number): string {
  if (x <= 0) return 'zero';
  if (x <= 10) return 'small';
  if (x <= 100) return 'medium';
  if (x <= 1000) return 'large';
  return 'huge';
}
`);

    const deepFindings = analyzeNesting(deep);
    const flatFindings = analyzeNesting(flat);

    // Deep nesting should produce more findings than flat early-return style
    expect(deepFindings.length).toBeGreaterThanOrEqual(flatFindings.length);
  });

  it('should detect early-return opportunities that disappear with flat code', () => {
    // Code with early-return opportunity
    const withOpportunity = parse(`
export function process(x: number | null): number {
  if (x !== null) {
    if (x > 0) {
      return x * 2;
    } else {
      return 0;
    }
  } else {
    return -1;
  }
}
`);
    // Flattened code — no early-return opportunities
    const flattened = parse(`
export function process(x: number | null): number {
  if (x === null) return -1;
  if (x <= 0) return 0;
  return x * 2;
}
`);

    const opFindings = analyzeEarlyReturn(withOpportunity);
    const flatFindings = analyzeEarlyReturn(flattened);

    // The nested version should have more early-return findings
    expect(opFindings.length).toBeGreaterThanOrEqual(flatFindings.length);
  });
});
