import { describe, it, expect } from 'bun:test';

import type { FirebatAnalyses } from '../../types';

import { flattenToFindings } from './flatten-findings';

const span = (line = 1, col = 0) => ({
  start: { line, column: col },
  end: { line: line + 1, column: 0 },
});

describe('flattenToFindings', () => {
  it('should return empty array for empty analyses', () => {
    expect(flattenToFindings({})).toEqual([]);
  });

  it('should flatten file-type waste finding', () => {
    const analyses: Partial<FirebatAnalyses> = {
      waste: [{ kind: 'dead-store', code: 'WASTE_DEAD_STORE', file: 'src/a.ts', span: span(10), label: 'unused x' } as any],
    };
    const findings = flattenToFindings(analyses);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.id).toMatch(/^waste-[0-9a-f]{12}$/);
    expect(findings[0]!.category).toBe('waste');
    expect(findings[0]!.code).toBe('WASTE_DEAD_STORE');
    expect(findings[0]!.file).toBe('src/a.ts');
    expect(findings[0]!.line).toBe(10);
    expect(findings[0]!.kind).toBe('dead-store');
    expect(findings[0]!.label).toBe('unused x');
    expect(findings[0]!.group_id).toBeNull();
    expect(findings[0]!.primary).toBe(true);
  });

  it('should prefer catalogCode over code for lint findings and preserve ruleCode in detail', () => {
    const analyses: Partial<FirebatAnalyses> = {
      lint: [{ severity: 'error', catalogCode: 'LINT', msg: 'no-unused', file: 'src/b.ts', span: span(5), code: 'no-unused-vars' } as any],
    };
    const findings = flattenToFindings(analyses);

    expect(findings).toHaveLength(1);
    expect(findings[0]!.code).toBe('LINT');
    expect(findings[0]!.label).toContain('no-unused');
    expect(findings[0]!.detail).toHaveProperty('ruleCode', 'no-unused-vars');
  });

  it('should decompose items-type duplicates into per-item findings', () => {
    const analyses: Partial<FirebatAnalyses> = {
      duplicates: [
        {
          cloneType: 'exact',
          code: 'DUP_EXACT',
          items: [
            { kind: 'function', header: 'fn processA', file: 'src/a.ts', span: span(1) },
            { kind: 'function', header: 'fn processB', file: 'src/b.ts', span: span(20) },
          ],
        } as any,
      ],
    };
    const findings = flattenToFindings(analyses);

    expect(findings).toHaveLength(2);

    // Primary
    expect(findings[0]!.primary).toBe(true);
    expect(findings[0]!.file).toBe('src/a.ts');
    expect(findings[0]!.group_id).toMatch(/^duplicates-[0-9a-f]{12}$/);
    expect(findings[0]!.detail).not.toBeNull();

    // Secondary
    expect(findings[1]!.primary).toBe(false);
    expect(findings[1]!.file).toBe('src/b.ts');
    expect(findings[1]!.group_id).toBe(findings[0]!.group_id);
    expect(findings[1]!.detail).toBeNull();
  });

  it('should generate stable IDs across calls with same input', () => {
    const analyses: Partial<FirebatAnalyses> = {
      waste: [{ kind: 'dead-store', code: 'WASTE_DEAD_STORE', file: 'src/a.ts', span: span(10), label: 'x' } as any],
    };
    const first = flattenToFindings(analyses);
    const second = flattenToFindings(analyses);

    expect(first[0]!.id).toBe(second[0]!.id);
  });

  it('should deduplicate findings with same content', () => {
    const finding = { kind: 'dead-store', code: 'WASTE_DEAD_STORE', file: 'src/a.ts', span: span(10), label: 'x' } as any;
    const analyses: Partial<FirebatAnalyses> = {
      waste: [finding, finding],
    };
    const findings = flattenToFindings(analyses);

    expect(findings).toHaveLength(1);
  });

  it('should produce informative label for nesting findings', () => {
    const analyses: Partial<FirebatAnalyses> = {
      nesting: [
        {
          kind: 'high-cognitive-complexity',
          code: 'NESTING_HIGH_CC',
          file: 'src/c.ts',
          header: 'function processData',
          span: span(5),
          metrics: { depth: 4, cognitiveComplexity: 25, callbackDepth: 0, quadraticTargets: [], density: 0, halsteadVolume: 0, halsteadDifficulty: 0 },
          signals: ['high-cognitive-complexity'],
          score: 1,
        } as any,
      ],
    };
    const findings = flattenToFindings(analyses);

    expect(findings[0]!.label).toContain('processData');
    expect(findings[0]!.label).toContain('CC: 25');
  });

  it('should produce informative label for dependency findings', () => {
    const analyses: Partial<FirebatAnalyses> = {
      dependencies: [
        { kind: 'dead-export', code: 'DEP_DEAD_EXPORT', file: 'src/mod.ts', span: span(), module: 'src/mod.ts', name: 'unusedFn' } as any,
      ],
    };
    const findings = flattenToFindings(analyses);

    expect(findings[0]!.label).toContain('unusedFn');
    expect(findings[0]!.label).toContain('dead-export');
  });

  it('should separate detail from common fields', () => {
    const analyses: Partial<FirebatAnalyses> = {
      nesting: [
        {
          kind: 'deep-nesting',
          code: 'NESTING_DEEP',
          file: 'src/d.ts',
          header: 'function deep',
          span: span(1),
          metrics: { depth: 8, cognitiveComplexity: 12, callbackDepth: 0, quadraticTargets: [], density: 0, halsteadVolume: 0, halsteadDifficulty: 0 },
          signals: ['deep-nesting'],
          score: 0.9,
        } as any,
      ],
    };
    const findings = flattenToFindings(analyses);
    const detail = findings[0]!.detail;

    expect(detail).not.toBeNull();
    // detail should contain metrics, signals, score but NOT kind, code, file, span
    expect(detail).toHaveProperty('metrics');
    expect(detail).toHaveProperty('signals');
    expect(detail).not.toHaveProperty('kind');
    expect(detail).not.toHaveProperty('code');
    expect(detail).not.toHaveProperty('file');
  });

  it('should decompose circular-dependency items with proper labels', () => {
    const analyses: Partial<FirebatAnalyses> = {
      dependencies: [
        {
          kind: 'circular-dependency',
          code: 'DIAG_CIRCULAR_DEPENDENCY',
          items: [
            { file: 'src/a.ts', span: span(1) },
            { file: 'src/b.ts', span: span(1) },
          ],
          cut: { from: 'src/a.ts', to: 'src/b.ts', score: 0.8 },
        } as any,
      ],
    };
    const findings = flattenToFindings(analyses);

    expect(findings).toHaveLength(2);
    expect(findings[0]!.primary).toBe(true);
    expect(findings[0]!.label).toContain('circular-dependency');
    expect(findings[0]!.label).toContain('src/a.ts');
    expect(findings[1]!.primary).toBe(false);
    expect(findings[1]!.label).toContain('src/b.ts');
    expect(findings[0]!.group_id).toBe(findings[1]!.group_id);
  });

  it('should handle multiple categories', () => {
    const analyses: Partial<FirebatAnalyses> = {
      waste: [{ kind: 'dead-store', code: 'WASTE_DEAD_STORE', file: 'src/a.ts', span: span(1), label: 'x' } as any],
      barrel: [{ kind: 'export-star', code: 'BARREL_EXPORT_STAR', file: 'src/index.ts', span: span(1), evidence: 'export * from ./mod' } as any],
    };
    const findings = flattenToFindings(analyses);

    expect(findings).toHaveLength(2);

    const categories = findings.map(f => f.category);

    expect(categories).toContain('waste');
    expect(categories).toContain('barrel');
  });
});
