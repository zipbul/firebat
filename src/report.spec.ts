import { describe, it, expect } from 'bun:test';

import { formatReport } from './report';
import type { FirebatReport } from './types';

describe('report', () => {
  it('should include ALL selected detectors in the summary table (including those with 0 findings)', () => {
    const report: FirebatReport = {
      meta: {
        engine: 'oxc',
        targetCount: 0,
        minSize: 0,
        maxForwardDepth: 0,
        detectors: ['exact-duplicates', 'giant-file', 'dependencies'],
        detectorTimings: {},
        errors: {},
      },
      analyses: {
        'exact-duplicates': [],
        'giant-file': [],
        dependencies: {
          cycles: [],
          adjacency: {},
          exportStats: {},
          fanIn: [],
          fanOut: [],
          cuts: [],
          layerViolations: [],
          deadExports: [],
        },
      },
      top: [],
      catalog: {},
    };
    const out = formatReport(report, 'text');

    expect(out).toContain('Exact Duplicates');
    expect(out).toContain('Giant File');
    expect(out).toContain('Dep Cycles');
  });
});
