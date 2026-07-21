import { describe, it, expect } from 'bun:test';

import type { FirebatReport, FirebatDetector } from './types';

import { expectTotalOne, span } from '../test/integration/shared/test-kit';
import { flattenToFindings } from './application/scan/flatten-findings';
import { formatReport } from './report';

// ── Helpers ─────────────────────────────────────────────────────────

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

const parseReport = (
  analyses: Partial<FirebatReport['analyses']> = {},
  metaErrors: Record<string, string> | undefined = {},
): any => {
  const base = makeReport(['waste'], analyses);
  const report: FirebatReport = { ...base, meta: { ...base.meta, errors: metaErrors } };

  return JSON.parse(formatReport(report));
};

interface ErrorsPresentRow {
  readonly name: string;
  readonly metaErrors: Record<string, string>;
  readonly key: string;
  readonly value: string;
  readonly count: number;
}

interface ErrorsAbsentRow {
  readonly name: string;
  readonly metaErrors: Record<string, string> | undefined;
}

const errorsPresentRows: ErrorsPresentRow[] = [
  { name: 'non-empty', metaErrors: { 'src/a.ts': 'parse error' }, key: 'src/a.ts', value: 'parse error', count: 1 },
  { name: 'exactly one key', metaErrors: { 'src/only.ts': 'err' }, key: 'src/only.ts', value: 'err', count: 1 },
];
const errorsAbsentRows: ErrorsAbsentRow[] = [
  { name: 'undefined', metaErrors: undefined },
  { name: 'empty object', metaErrors: {} },
];

// ── Tests ───────────────────────────────────────────────────────────

describe('formatReport', () => {
  it('should return valid JSON string', () => {
    const out = formatReport(makeReport(['waste'], { waste: [] }));

    expect(() => JSON.parse(out)).not.toThrow();
  });

  it('should output meta.detectors and total at root level', () => {
    const parsed = parseReport({
      waste: [{ kind: 'dead-store', code: 'WASTE_DEAD_STORE', label: 'x', message: '', file: testFile, span: span() } as any],
    });

    expect(parsed.meta.detectors).toContain('waste');
    expect(typeof parsed.total).toBe('number');
    expect(Array.isArray(parsed.findings)).toBe(true);
    expect('analyses' in parsed).toBe(false);
  });

  it('should populate findings from analyses via flattenToFindings', () => {
    const parsed = parseReport({
      waste: [
        { kind: 'dead-store', code: 'WASTE_DEAD_STORE', label: 'unused x', message: '', file: testFile, span: span(10) } as any,
      ],
    });

    expectTotalOne(parsed);
    expect(parsed.findings[0].category).toBe('waste');
    expect(parsed.findings[0].line).toBe(10);
  });

  it.each(errorsPresentRows)('should include errors in meta when meta.errors is $name', row => {
    const parsed = parseReport({ waste: [] }, row.metaErrors);

    expect(parsed.meta.errors).toBeDefined();
    expect(parsed.meta.errors[row.key]).toBe(row.value);
    expect(Object.keys(parsed.meta.errors).length).toBe(row.count);
  });

  it.each(errorsAbsentRows)('should omit errors key in meta when meta.errors is $name', row => {
    const parsed = parseReport({ waste: [] }, row.metaErrors);

    expect('errors' in parsed.meta).toBe(false);
  });

  it('preserves required Finding fields through JSON round-trip', () => {
    const parsed = parseReport({
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
    const parsed = parseReport({
      waste: [
        { kind: 'dead-store', code: 'WASTE_DEAD_STORE', label: 'a', message: '', file: testFile, span: span(1) } as any,
        { kind: 'dead-store', code: 'WASTE_DEAD_STORE', label: 'b', message: '', file: testFile, span: span(2) } as any,
        { kind: 'dead-store', code: 'WASTE_DEAD_STORE', label: 'c', message: '', file: testFile, span: span(3) } as any,
      ],
    });

    expect(parsed.total).toBe(3);
    expect(parsed.findings).toHaveLength(3);
  });

  it('output shape exact — only meta, total, findings, catalog at root', () => {
    const parsed = parseReport({ waste: [] });

    expect(Object.keys(parsed).sort()).toEqual(['catalog', 'findings', 'meta', 'total']);
  });
});
