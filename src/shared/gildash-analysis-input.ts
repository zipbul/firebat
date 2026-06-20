import type { Gildash } from '@zipbul/gildash';

/**
 * Shared input contract for analyzers whose only option is an optional gildash
 * instance for semantic enrichment.
 *
 * Single source of truth: error-flow and temporal-coupling analyzers take the
 * identical input shape, so a change to that contract must apply to both at once.
 */
export interface GildashAnalysisInput {
  readonly gildash?: Gildash;
}
