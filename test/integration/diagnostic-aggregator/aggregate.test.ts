import { describe, expect, it } from 'bun:test';
// Phase 0: DiagnosticAggregator should synthesize top/catalog from detector analyses.
// NOTE: This test is intentionally written before implementation (RED first).

import { aggregateDiagnostics } from '../../../src/application/scan/diagnostic-aggregator';

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
    expect(out.top.some((p: any) => p.pattern === 'DIAG_GOD_FUNCTION')).toBe(true);
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
    expect(out.top.some((p: any) => p.pattern === 'DIAG_CIRCULAR_DEPENDENCY')).toBe(true);
    expect(out.catalog.DIAG_CIRCULAR_DEPENDENCY).toBeDefined();
  });

  it('should emit DIAG_GOD_MODULE when coupling has god-module signal', () => {
    // Arrange
    const out = aggregateDiagnostics({
      analyses: {
        coupling: [
          {
            kind: 'god-module',
            code: 'COUPLING_GOD_MODULE',
            file: 'src/mod.ts',
            span: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } },
            module: 'src/mod.ts',
            score: 1,
            signals: ['god-module'],
            metrics: { fanIn: 10, fanOut: 10, instability: 0.5, abstractness: 0.2, distance: 0.3 },
          },
        ],
      },
    } as any);

    // Assert
    expect(out.top.some((p: any) => p.pattern === 'DIAG_GOD_MODULE')).toBe(true);
    expect(out.catalog.DIAG_GOD_MODULE).toBeDefined();
  });
});
