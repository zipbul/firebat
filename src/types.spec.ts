import { describe, it, expect } from 'bun:test';

import { toJsonReport, countBlockers } from './types';
import type { FirebatReport, FirebatAnalyses, LintDiagnostic, TypecheckItem, FormatFinding, SourceSpan, WasteFinding, BarrelPolicyFinding, UnknownProofFinding, ForwardingFinding, DuplicateGroup, GiantFileFinding } from './types';
import type { ExceptionHygieneFinding } from './features/exception-hygiene/types';

// ── Helpers ─────────────────────────────────────────────────────────

const span = (line = 1, col = 0): SourceSpan => ({
  start: { line, column: col },
  end: { line: line + 1, column: 0 },
});

const makeReport = (overrides: Partial<FirebatReport['meta']> = {}, analyses: Partial<FirebatAnalyses> = { waste: [] }): FirebatReport => ({
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
});

// ── Tests ────────────────────────────────────────────────────────────

describe('toJsonReport', () => {
  it('should include errors at root when meta.errors is non-empty', () => {
    const report = makeReport({ errors: { 'src/a.ts': 'parse error' } });
    const out = toJsonReport(report);

    expect(out.errors).toEqual({ 'src/a.ts': 'parse error' });
  });

  it('should omit errors key when meta.errors is not present', () => {
    const base = makeReport();
    const { errors: _e, ...metaNoErrors } = base.meta;
    const report: FirebatReport = { ...base, meta: metaNoErrors as FirebatReport['meta'] };
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

  it('should include blockers field in output', () => {
    const report = makeReport({}, { waste: [] });
    const out = toJsonReport(report);

    expect('blockers' in out).toBe(true);
  });

  it('should reflect actual blocking count in blockers field', () => {
    const report = makeReport({}, {
      waste: [{ kind: 'dead-store', label: 'x', message: '', filePath: 'a.ts', span: span(), confidence: 1 } as WasteFinding],
      lint: [
        { severity: 'error', code: 'a', msg: 'err', file: 'b.ts', span: span() } as LintDiagnostic,
        { severity: 'warning', code: 'b', msg: 'warn', file: 'b.ts', span: span() } as LintDiagnostic,
      ],
    });
    const out = toJsonReport(report);

    expect(out.blockers).toBe(3);
  });

  it('should set blockers to 0 when no blocking findings', () => {
    const report = makeReport({}, { waste: [] });
    const out = toJsonReport(report);

    expect(out.blockers).toBe(0);
  });
});

// ── countBlockers ────────────────────────────────────────────────────

describe('countBlockers', () => {
  it('should return count of all findings across present detectors when all present', () => {
    const analyses: Partial<FirebatAnalyses> = {
      duplicates: [{ findingKind: 'exact-clone', items: [{ kind: 'function', header: 'a', filePath: 'a.ts', span: span() }] } as DuplicateGroup],
      waste: [{ kind: 'dead-store', label: 'x', message: '', filePath: 'a.ts', span: span(), confidence: 1 } as WasteFinding],
      'barrel-policy': [{ kind: 'deep-import', file: 'a.ts', span: span() } as BarrelPolicyFinding],
      'unknown-proof': [{ kind: 'type-assertion', message: '', filePath: 'a.ts', span: span() } as UnknownProofFinding],
      'exception-hygiene': [{ kind: 'throw-non-error', file: 'a.ts', span: span(), evidence: '' } as ExceptionHygieneFinding],
      format: [{ code: 'FMT_NEEDS_FORMATTING' as any, kind: 'needs-formatting', file: 'a.ts', span: span() } as FormatFinding],
      lint: [{ severity: 'error', code: 'no-unused-vars', msg: 'err', file: 'a.ts', span: span() } as LintDiagnostic],
      typecheck: [{ severity: 'error', code: 'TS2322', msg: 'err', file: 'a.ts', span: span(), codeFrame: '' } as TypecheckItem],
      forwarding: [{ kind: 'forwarding', file: 'a.ts', span: span() } as unknown as ForwardingFinding],
    };

    expect(countBlockers(analyses)).toBe(9);
  });

  it('should return count for single detector when only one present', () => {
    expect(countBlockers({ waste: [{ kind: 'dead-store', label: 'x', message: '', filePath: 'a.ts', span: span(), confidence: 1 } as WasteFinding] })).toBe(1);
  });

  it('should count all lint findings regardless of severity when mixed severities', () => {
    const analyses: Partial<FirebatAnalyses> = {
      lint: [
        { severity: 'error', code: 'a', msg: 'err', file: 'a.ts', span: span() } as LintDiagnostic,
        { severity: 'error', code: 'b', msg: 'err2', file: 'a.ts', span: span() } as LintDiagnostic,
        { severity: 'warning', code: 'c', msg: 'warn', file: 'a.ts', span: span() } as LintDiagnostic,
      ],
    };

    expect(countBlockers(analyses)).toBe(3);
  });

  it('should count all typecheck findings regardless of severity when mixed severities', () => {
    const analyses: Partial<FirebatAnalyses> = {
      typecheck: [
        { severity: 'error', code: 'TS2322', msg: 'err', file: 'a.ts', span: span(), codeFrame: '' } as TypecheckItem,
        { severity: 'warning', code: 'TS6133', msg: 'warn', file: 'a.ts', span: span(), codeFrame: '' } as TypecheckItem,
      ],
    };

    expect(countBlockers(analyses)).toBe(2);
  });

  it('should return 0 when analyses is empty', () => {
    expect(countBlockers({})).toBe(0);
  });

  it('should count lint warnings as blockers when only warnings present', () => {
    const analyses: Partial<FirebatAnalyses> = {
      lint: [
        { severity: 'warning', code: 'a', msg: 'warn', file: 'a.ts', span: span() } as LintDiagnostic,
      ],
    };

    expect(countBlockers(analyses)).toBe(1);
  });

  it('should return 0 when all blocking detectors have empty arrays', () => {
    const analyses: Partial<FirebatAnalyses> = {
      duplicates: [],
      waste: [],
      'barrel-policy': [],
      'unknown-proof': [],
      'exception-hygiene': [],
      format: [],
      lint: [],
      typecheck: [],
      forwarding: [],
    };

    expect(countBlockers(analyses)).toBe(0);
  });

  it('should treat undefined detectors as 0', () => {
    const analyses: Partial<FirebatAnalyses> = {
      waste: [{ kind: 'dead-store', label: 'x', message: '', filePath: 'a.ts', span: span(), confidence: 1 } as WasteFinding],
      // all others undefined
    };

    expect(countBlockers(analyses)).toBe(1);
  });

  it('should count warnings from lint and typecheck as blockers when only warnings and others empty', () => {
    const analyses: Partial<FirebatAnalyses> = {
      duplicates: [],
      waste: [],
      lint: [{ severity: 'warning', code: 'a', msg: 'warn', file: 'a.ts', span: span() } as LintDiagnostic],
      typecheck: [{ severity: 'warning', code: 'TS6133', msg: 'warn', file: 'a.ts', span: span(), codeFrame: '' } as TypecheckItem],
    };

    expect(countBlockers(analyses)).toBe(2);
  });

  it('should count giant-file findings as blockers when present', () => {
    const analyses: Partial<FirebatAnalyses> = {
      'giant-file': [{ kind: 'giant-file', file: 'src/big.ts', span: span(), metrics: { lineCount: 900, maxLines: 800 }, code: 'GIANT_FILE' } as GiantFileFinding],
    };

    expect(countBlockers(analyses)).toBe(1);
  });

  it('should return same result when called twice with same input', () => {
    const analyses: Partial<FirebatAnalyses> = {
      waste: [{ kind: 'dead-store', label: 'x', message: '', filePath: 'a.ts', span: span(), confidence: 1 } as WasteFinding],
    };

    expect(countBlockers(analyses)).toBe(countBlockers(analyses));
  });
});
