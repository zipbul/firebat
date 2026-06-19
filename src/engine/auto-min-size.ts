import type { ParsedFile } from './types';

/**
 * Duplicates min-size floor — ABSOLUTE and corpus-INDEPENDENT.
 *
 * The floor is a fixed property of a code unit ("is this statement-run / rule-data
 * table a large enough decision unit?"), NOT a function of the rest of the corpus.
 * A corpus-relative percentile made the same pair's clone verdict depend on
 * unrelated files — breaking firebat's closed / corpus-independent identity (its
 * differentiator vs jscpd/SonarQube) and making the reported clone count
 * non-monotonic: removing clones shrank the corpus, lowered the median, lowered the
 * floor, and surfaced previously-hidden clones. (See memory:
 * project-duplicates-auto-minsize-design-flaw.)
 *
 * NOTE: declarations (functions/classes/types/contracts) have NO floor — a
 * duplicated declaration is a clone at any size (see analyzer.ts). This floor
 * applies only to statement-run fragments and rule-data tables, where a tiny
 * run/table is genuine noise (a lone log line, a 1-entry table). Calibrated against
 * the CLAUDE.md statement-run W/K examples (golden: stmt-run-too-small-keep).
 */
export const DUPLICATES_MIN_SIZE = 12;

/**
 * Resolve the duplicates min-size floor for the scan usecase's `'auto'` option.
 *
 * Kept as a function so the call site needs no change, but it is corpus-independent
 * by construction: the corpus is accepted and ignored. The floor is the fixed
 * policy constant above, never a statistic of the input.
 */
export const computeAutoMinSize = (_files: ReadonlyArray<ParsedFile>): number => DUPLICATES_MIN_SIZE;
