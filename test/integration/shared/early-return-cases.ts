import { expect } from 'bun:test';

import type { EarlyReturnItem } from '../../../src/types';

import { analyzeEarlyReturn } from '../../../src/features/early-return/analyzer';
import { parseProgram } from './test-kit';

/** Partial metric shape asserted within an {@link ExpectedFinding}. */
export interface ExpectedMetrics {
  readonly depthReduction?: number;
  readonly statementsAffected?: number;
}

/** Partial finding shape asserted against the primary early-return item via `toMatchObject`. */
export interface ExpectedFinding {
  readonly kind?: EarlyReturnItem['kind'];
  readonly score?: number;
  readonly metrics?: ExpectedMetrics;
}

/**
 * A source snippet plus the single finding it is expected to produce.
 *
 * `expected` is always present (use `{}` when only the finding count matters) so
 * assertions stay unconditional.
 */
export interface DetectionCase {
  readonly label: string;
  readonly source: string;
  readonly expected: ExpectedFinding;
}

/** A source snippet expected to produce no early-return findings. */
export interface NoFindingCase {
  readonly label: string;
  readonly source: string;
}

/** Parse `source`, analyze it, and assert exactly one finding matching `expected`. */
export const expectDetection = ({ source, expected }: DetectionCase): void => {
  const result = analyzeEarlyReturn(parseProgram(source));

  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject(expected);
};

/** Parse `source`, analyze it, and assert no findings are produced. */
export const expectNoFinding = ({ source }: NoFindingCase): void => {
  const result = analyzeEarlyReturn(parseProgram(source));

  expect(result).toEqual([]);
};
