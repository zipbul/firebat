import { describe, it, expect } from 'bun:test';

import type { FirebatReport, FirebatAnalyses } from './types';

import { toScanResult } from './types';

// ── Helpers ─────────────────────────────────────────────────────────

const makeReport = (
  overrides: Partial<FirebatReport['meta']> = {},
  analyses: Partial<FirebatAnalyses> = { waste: [] },
  findings: FirebatReport['findings'] = [],
): FirebatReport => ({
  meta: {
    engine: 'oxc',
    targetCount: 1,
    minSize: 0,
    maxForwardDepth: 0,
    detectors: ['waste'],
    detectorTimings: {},
    errors: {},
    ...overrides,
  },
  analyses,
  catalog: {},
  findings,
});

// ── Tests ────────────────────────────────────────────────────────────

describe('toScanResult', () => {
  it('includes errors in meta when meta.errors is non-empty', () => {
    const report = makeReport({ errors: { 'src/a.ts': 'parse error' } });
    const out = toScanResult(report);

    expect(out.meta.errors).toEqual({ 'src/a.ts': 'parse error' });
  });

  it('omits errors in meta when meta.errors is not present', () => {
    const base = makeReport();
    const { errors: _e, ...metaNoErrors } = base.meta;
    const report: FirebatReport = { ...base, meta: metaNoErrors as FirebatReport['meta'] };
    const out = toScanResult(report);

    expect('errors' in out.meta).toBe(false);
  });

  it('omits errors in meta when meta.errors is empty object', () => {
    const report = makeReport({ errors: {} });
    const out = toScanResult(report);

    expect('errors' in out.meta).toBe(false);
  });

  it('places detectors under meta from meta.detectors', () => {
    const report = makeReport({ detectors: ['waste', 'nesting'] });
    const out = toScanResult(report);

    expect(out.meta.detectors).toEqual(['waste', 'nesting']);
  });

  it('uses findings.length as total', () => {
    const report = makeReport({}, { waste: [] }, [
      {
        id: 'waste-abc',
        category: 'waste',
        code: 'WASTE_DEAD_STORE',
        file: 'src/a.ts',
        line: 10,
        kind: 'dead-store',
        label: 'unused x',
      },
    ]);
    const out = toScanResult(report);

    expect(out.total).toBe(1);
    expect(out.findings).toHaveLength(1);
  });

  it('does not include analyses or catalog in output', () => {
    const report: FirebatReport = {
      ...makeReport(),
      catalog: { WASTE_DEAD_STORE: { cause: 'unused variable', think: ['remove it'] } },
    };
    const out = toScanResult(report);

    expect((out as unknown as Record<string, unknown>).analyses).toBeUndefined();
    expect((out as unknown as Record<string, unknown>).catalog).toBeUndefined();
  });

  it('sets total to 0 when no findings', () => {
    const report = makeReport({}, { waste: [] }, []);
    const out = toScanResult(report);

    expect(out.total).toBe(0);
    expect(out.findings).toEqual([]);
  });

  it('includes errors in meta when meta.errors has exactly one key', () => {
    const report = makeReport({ errors: { 'src/only.ts': 'error' } });
    const out = toScanResult(report);

    expect(out.meta.errors).toBeDefined();
    expect(Object.keys(out.meta.errors!).length).toBe(1);
  });

  it('top-level keys are exactly meta, total, findings (no extras)', () => {
    const report = makeReport({ errors: { x: 'y' } });
    const out = toScanResult(report);

    expect(Object.keys(out).sort()).toEqual(['findings', 'meta', 'total']);
  });

  it('meta does not include targetCount, minSize, maxForwardDepth, detectorTimings, engine', () => {
    const report = makeReport({
      engine: 'oxc',
      targetCount: 99,
      minSize: 10,
      maxForwardDepth: 3,
      detectorTimings: { waste: 5 },
    });
    const out = toScanResult(report);

    expect(out.meta).not.toHaveProperty('targetCount');
    expect(out.meta).not.toHaveProperty('minSize');
    expect(out.meta).not.toHaveProperty('maxForwardDepth');
    expect(out.meta).not.toHaveProperty('detectorTimings');
    expect(out.meta).not.toHaveProperty('engine');
  });

  it('findings reference is the same array from report (no copy)', () => {
    const report = makeReport({}, {}, [
      { id: 'x', category: 'waste', code: 'WASTE_DEAD_STORE', file: 'a.ts', line: 1, kind: 'dead-store', label: 'x' },
    ]);
    const out = toScanResult(report);

    expect(out.findings).toBe(report.findings);
  });

  it('total reflects multi-finding count', () => {
    const f = (id: string) => ({
      id,
      category: 'waste',
      code: 'WASTE_DEAD_STORE',
      file: 'a.ts',
      line: 1,
      kind: 'dead-store',
      label: 'x',
    });
    const report = makeReport({}, {}, [f('a'), f('b'), f('c')]);
    const out = toScanResult(report);

    expect(out.total).toBe(3);
  });

  it('JSON-serializable output round-trip preserves findings', () => {
    const report = makeReport({ errors: { x: 'y' } }, {}, [
      {
        id: 'x',
        category: 'waste',
        code: 'WASTE_DEAD_STORE',
        file: 'a.ts',
        line: 1,
        kind: 'dead-store',
        label: 'x',
        detail: { span: { start: { line: 1, column: 0 }, end: { line: 1, column: 5 } } },
      },
    ]);
    const out = toScanResult(report);
    const json = JSON.stringify(out);

    expect(() => JSON.parse(json)).not.toThrow();

    const roundtrip = JSON.parse(json);

    expect(roundtrip.total).toBe(1);
    expect(roundtrip.findings[0].detail.span.start.line).toBe(1);
    // Default-valued fields are omitted in JSON
    expect(roundtrip.findings[0]).not.toHaveProperty('groupId');
    expect(roundtrip.findings[0]).not.toHaveProperty('primary');
  });
});
