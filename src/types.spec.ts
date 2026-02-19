import { describe, it, expect } from 'bun:test';

import { toJsonReport } from './types';
import type { FirebatReport } from './types';

// ── Helpers ─────────────────────────────────────────────────────────

const makeReport = (overrides: Partial<FirebatReport['meta']> = {}): FirebatReport => ({
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
  analyses: { waste: [] },
  catalog: {},
});

// ── Tests ────────────────────────────────────────────────────────────

describe('toJsonReport', () => {
  it('should include errors at root when meta.errors is non-empty', () => {
    const report = makeReport({ errors: { 'src/a.ts': 'parse error' } });
    const out = toJsonReport(report);

    expect(out.errors).toEqual({ 'src/a.ts': 'parse error' });
  });

  it('should omit errors key when meta.errors is undefined', () => {
    const report = makeReport({ errors: undefined });
    const out = toJsonReport(report);

    expect('errors' in out).toBe(false);
  });

  it('should omit errors key when meta.errors is empty object', () => {
    const report = makeReport({ errors: {} });
    const out = toJsonReport(report);

    expect('errors' in out).toBe(false);
  });

  it('should place detectors at root level from meta.detectors', () => {
    const report = makeReport({ detectors: ['waste', 'nesting'] });
    const out = toJsonReport(report);

    expect(out.detectors).toEqual(['waste', 'nesting']);
  });

  it('should pass analyses through unchanged', () => {
    const report = makeReport();
    const out = toJsonReport(report);

    expect(out.analyses).toBe(report.analyses);
  });

  it('should pass catalog through unchanged', () => {
    const report: FirebatReport = {
      ...makeReport(),
      catalog: { WASTE_DEAD_STORE: { cause: 'unused variable', think: ['remove it'] } },
    };
    const out = toJsonReport(report);

    expect(out.catalog).toBe(report.catalog);
  });

  it('should not include meta key in output', () => {
    const report = makeReport();
    const out = toJsonReport(report);

    expect('meta' in out).toBe(false);
  });

  it('should include errors at root when meta.errors has exactly one key', () => {
    const report = makeReport({ errors: { 'src/only.ts': 'error' } });
    const out = toJsonReport(report);

    expect(out.errors).toBeDefined();
    expect(Object.keys(out.errors!).length).toBe(1);
  });
});
