import { describe, expect, it } from 'bun:test';
// Phase 0: DiagnosticAggregator should synthesize top/catalog from detector analyses.
// NOTE: This test is intentionally written before implementation (RED first).

import { aggregateDiagnostics } from '../../../../src/test-api';

describe('integration/diagnostic-aggregator', () => {
  it('should emit DIAG_GOD_FUNCTION when nesting(high-cc) + waste co-occur in same function', () => {
    // Arrange
    const out = aggregateDiagnostics({
      analyses: {
        waste: [
          {
            kind: 'dead-store',
            code: 'WASTE_DEAD_STORE',
            file: 'src/a.ts',
            span: { start: { line: 10, column: 0 }, end: { line: 10, column: 1 } },
          },
        ],
        nesting: [
          {
            kind: 'high-cognitive-complexity',
            code: 'NESTING_HIGH_CC',
            file: 'src/a.ts',
            header: 'function handle()',
            span: { start: { line: 1, column: 0 }, end: { line: 50, column: 0 } },
            score: 0.9,
            metrics: { depth: 3, cognitiveComplexity: 20, callbackDepth: 0, quadraticTargets: [] },
          },
        ],
      },
    } as any);

    // Assert
    expect(out.catalog.DIAG_GOD_FUNCTION).toBeDefined();
  });

  it('should never emit DIAG_CIRCULAR_DEPENDENCY — scan.usecase always enriches dependencies into a flat finding-row array with no .cycles property, so the code ships via the catalog seenCodes mechanism instead', () => {
    // Arrange — a raw {cycles:[...]} shape never actually reaches
    // aggregateDiagnostics in production (scan.usecase's `dependencies`
    // analysis is always the enriched flat array by the time it gets here).
    const out = aggregateDiagnostics({
      analyses: {
        dependencies: {
          cycles: [{ path: ['src/a.ts', 'src/b.ts', 'src/a.ts'] }],
          adjacency: {},
          exportStats: {},
          fanIn: [],
          fanOut: [],
          cuts: [],
          layerViolations: [],
          deadExports: [],
        },
      },
    } as any);

    // Assert
    expect(out.catalog.DIAG_CIRCULAR_DEPENDENCY).toBeUndefined();
  });
});
