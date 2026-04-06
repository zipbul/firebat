import { describe, it, expect } from 'bun:test';

import type { FirebatReport, FirebatDetector } from './types';

import { formatReport } from './report';

// ── Helpers ─────────────────────────────────────────────────────────

const span = (line = 1, col = 0) => ({
  start: { line, column: col },
  end: { line: line + 1, column: 0 },
});

const testFile = `${process.cwd()}/test-file.ts`;

const makeReport = (
  detectors: ReadonlyArray<FirebatDetector>,
  analyses: Partial<FirebatReport['analyses']> = {},
): FirebatReport => ({
  meta: { engine: 'oxc', targetCount: 1, minSize: 0, maxForwardDepth: 0, detectors, detectorTimings: {}, errors: {} },
  analyses,
  catalog: {},
});

// ── Tests ───────────────────────────────────────────────────────────

describe('formatReport', () => {
  it('should return valid JSON string', () => {
    const report = makeReport(['waste'], { waste: [] });
    const out = formatReport(report);

    expect(() => JSON.parse(out)).not.toThrow();
  });

  it('should output detectors at root level and omit meta key', () => {
    const report = makeReport(['waste'], {
      waste: [{ kind: 'dead-store', label: 'x', message: '', filePath: testFile, span: span() }],
    });
    const parsed = JSON.parse(formatReport(report));

    expect(Array.isArray(parsed.detectors)).toBe(true);
    expect(parsed.detectors).toContain('waste');
    expect('meta' in parsed).toBe(false);
    expect(Array.isArray(parsed.analyses.waste)).toBe(true);
  });

  it('should include errors at root when meta.errors is non-empty', () => {
    const report: FirebatReport = {
      ...makeReport(['waste'], { waste: [] }),
      meta: { ...makeReport(['waste']).meta, errors: { 'src/a.ts': 'parse error' } },
    };
    const parsed = JSON.parse(formatReport(report));

    expect(parsed.errors).toBeDefined();
    expect(parsed.errors['src/a.ts']).toBe('parse error');
  });

  it('should omit errors key when meta.errors is undefined', () => {
    const report: FirebatReport = {
      ...makeReport(['waste'], { waste: [] }),
      meta: (({ errors: _e, ...rest }) => rest)(makeReport(['waste']).meta),
    };
    const parsed = JSON.parse(formatReport(report));

    expect('errors' in parsed).toBe(false);
  });

  it('should omit errors key when meta.errors is empty object', () => {
    const report = makeReport(['waste'], { waste: [] });
    const parsed = JSON.parse(formatReport(report));

    expect('errors' in parsed).toBe(false);
  });

  it('should include errors at root when meta.errors has exactly one key', () => {
    const report: FirebatReport = {
      ...makeReport(['waste'], { waste: [] }),
      meta: { ...makeReport(['waste']).meta, errors: { 'src/only.ts': 'err' } },
    };
    const parsed = JSON.parse(formatReport(report));

    expect(parsed.errors).toBeDefined();
    expect(Object.keys(parsed.errors).length).toBe(1);
  });
});
