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

  it('should emit DIAG_CIRCULAR_DEPENDENCY when dependencies.cycles is non-empty', () => {
    // Arrange
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
    expect(out.catalog.DIAG_CIRCULAR_DEPENDENCY).toBeDefined();
  });
});
