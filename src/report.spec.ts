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
  findings: [],
});

// ── Tests ───────────────────────────────────────────────────────────

describe('formatReport', () => {
  it('should return valid JSON string', () => {
    const report = makeReport(['waste'], { waste: [] });
    const out = formatReport(report);

    expect(() => JSON.parse(out)).not.toThrow();
  });

  it('should output meta.detectors and total at root level', () => {
    const report = makeReport(['waste'], {
      waste: [{ kind: 'dead-store', label: 'x', message: '', filePath: testFile, span: span() }],
    });
    const parsed = JSON.parse(formatReport(report));

    expect(parsed.meta.detectors).toContain('waste');
    expect(typeof parsed.total).toBe('number');
    expect(Array.isArray(parsed.findings)).toBe(true);
    expect('analyses' in parsed).toBe(false);
  });

  it('should include errors in meta when meta.errors is non-empty', () => {
    const report: FirebatReport = {
      ...makeReport(['waste'], { waste: [] }),
      meta: { ...makeReport(['waste']).meta, errors: { 'src/a.ts': 'parse error' } },
    };
    const parsed = JSON.parse(formatReport(report));

    expect(parsed.meta.errors).toBeDefined();
    expect(parsed.meta.errors['src/a.ts']).toBe('parse error');
  });

  it('should omit errors key in meta when meta.errors is undefined', () => {
    const report: FirebatReport = {
      ...makeReport(['waste'], { waste: [] }),
      meta: (({ errors: _e, ...rest }) => rest)(makeReport(['waste']).meta),
    };
    const parsed = JSON.parse(formatReport(report));

    expect('errors' in parsed.meta).toBe(false);
  });

  it('should omit errors key in meta when meta.errors is empty object', () => {
    const report = makeReport(['waste'], { waste: [] });
    const parsed = JSON.parse(formatReport(report));

    expect('errors' in parsed.meta).toBe(false);
  });

  it('should include errors in meta when meta.errors has exactly one key', () => {
    const report: FirebatReport = {
      ...makeReport(['waste'], { waste: [] }),
      meta: { ...makeReport(['waste']).meta, errors: { 'src/only.ts': 'err' } },
    };
    const parsed = JSON.parse(formatReport(report));

    expect(parsed.meta.errors).toBeDefined();
    expect(Object.keys(parsed.meta.errors).length).toBe(1);
  });
});
