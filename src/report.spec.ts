import { describe, it, expect } from 'bun:test';

import type { FirebatReport, FirebatDetector } from './types';

import { flattenToFindings } from './application/scan/flatten-findings';
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
  findings: flattenToFindings(analyses),
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
      waste: [{ kind: 'dead-store', code: 'WASTE_DEAD_STORE', label: 'x', message: '', file: testFile, span: span() } as any],
    });
    const parsed = JSON.parse(formatReport(report));

    expect(parsed.meta.detectors).toContain('waste');
    expect(typeof parsed.total).toBe('number');
    expect(Array.isArray(parsed.findings)).toBe(true);
    expect('analyses' in parsed).toBe(false);
  });

  it('should populate findings from analyses via flattenToFindings', () => {
    const report = makeReport(['waste'], {
      waste: [
        { kind: 'dead-store', code: 'WASTE_DEAD_STORE', label: 'unused x', message: '', file: testFile, span: span(10) } as any,
      ],
    });
    const parsed = JSON.parse(formatReport(report));

    expect(parsed.total).toBe(1);
    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0].category).toBe('waste');
    expect(parsed.findings[0].line).toBe(10);
  });

  it('never emits errors in meta — detector errors go to stderr, not stdout JSON', () => {
    const report: FirebatReport = {
      ...makeReport(['waste'], { waste: [] }),
      meta: { ...makeReport(['waste']).meta, errors: { 'src/a.ts': 'parse error', typecheck: 'tsconfig missing' } },
    };
    const parsed = JSON.parse(formatReport(report));

    expect('errors' in parsed.meta).toBe(false);
  });

  it('omits errors key in meta when meta.errors is undefined', () => {
    const report: FirebatReport = {
      ...makeReport(['waste'], { waste: [] }),
      meta: (({ errors: _e, ...rest }) => rest)(makeReport(['waste']).meta),
    };
    const parsed = JSON.parse(formatReport(report));

    expect('errors' in parsed.meta).toBe(false);
  });

  it('omits errors key in meta when meta.errors is empty object', () => {
    const report = makeReport(['waste'], { waste: [] });
    const parsed = JSON.parse(formatReport(report));

    expect('errors' in parsed.meta).toBe(false);
  });

  it('preserves required Finding fields through JSON round-trip', () => {
    const report = makeReport(['waste'], {
      waste: [
        {
          kind: 'dead-store',
          code: 'WASTE_DEAD_STORE',
          label: 'unused result',
          message: 'm',
          file: testFile,
          span: span(42),
        } as any,
      ],
    });
    const parsed = JSON.parse(formatReport(report));
    const finding = parsed.findings[0];

    expect(finding).toHaveProperty('id');
    expect(finding).toHaveProperty('category', 'waste');
    expect(finding).toHaveProperty('code', 'WASTE_DEAD_STORE');
    expect(finding).toHaveProperty('file', testFile);
    expect(finding).toHaveProperty('line', 42);
    expect(finding).toHaveProperty('kind', 'dead-store');
    expect(finding).toHaveProperty('label', 'unused result');
    // Default-valued fields omitted for compactness
    expect(finding).not.toHaveProperty('groupId');
    expect(finding).not.toHaveProperty('primary');
  });

  it('emits total matching findings.length', () => {
    const report = makeReport(['waste'], {
      waste: [
        { kind: 'dead-store', code: 'WASTE_DEAD_STORE', label: 'a', message: '', file: testFile, span: span(1) } as any,
        { kind: 'dead-store', code: 'WASTE_DEAD_STORE', label: 'b', message: '', file: testFile, span: span(2) } as any,
        { kind: 'dead-store', code: 'WASTE_DEAD_STORE', label: 'c', message: '', file: testFile, span: span(3) } as any,
      ],
    });
    const parsed = JSON.parse(formatReport(report));

    expect(parsed.total).toBe(3);
    expect(parsed.findings).toHaveLength(3);
  });

  it('output shape exact — only meta, total, findings at root', () => {
    const report = makeReport(['waste'], { waste: [] });
    const parsed = JSON.parse(formatReport(report));

    expect(Object.keys(parsed).sort()).toEqual(['findings', 'meta', 'total']);
  });
});
