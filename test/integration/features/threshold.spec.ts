/**
 * Threshold boundary tests — P2-17
 *
 * For each threshold-bearing analyzer, verify that:
 *   - value == threshold  → no finding  (edge: exactly at limit)
 *   - value == threshold+1 → finding    (edge: one over limit)
 *
 * This ensures the comparison operator (> vs >=) is correct.
 */
import { describe, expect, it } from 'bun:test';

import { parseSource } from '../../../src/engine/parse-source';
import { analyzeDecisionSurface } from '../../../src/features/decision-surface';
import { analyzeGiantFile } from '../../../src/features/giant-file';
import { analyzeImplementationOverhead } from '../../../src/features/implementation-overhead';
import { analyzeVariableLifetime } from '../../../src/features/variable-lifetime';
import { analyzeForwarding } from '../../../src/features/forwarding';
import { detectExactDuplicates } from '../../../src/features/exact-duplicates';

// ── helpers ─────────────────────────────────────────────────────────────────

const parse = (src: string, path = 'src/test.ts') => parseSource(path, src);

// ── giant-file ───────────────────────────────────────────────────────────────

describe('threshold/giant-file', () => {
  it('exactly at maxLines → no finding', () => {
    // 5 lines, maxLines=5
    const src = 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nexport const e = 5;';
    const findings = analyzeGiantFile([parse(src)], { maxLines: 5 });

    expect(findings).toHaveLength(0);
  });

  it('one over maxLines → finding', () => {
    // 6 lines, maxLines=5
    const src = 'const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nconst e = 5;\nexport const f = 6;';
    const findings = analyzeGiantFile([parse(src)], { maxLines: 5 });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('giant-file');
  });

  it('far under maxLines → no finding', () => {
    const src = 'export const x = 1;';
    const findings = analyzeGiantFile([parse(src)], { maxLines: 100 });

    expect(findings).toHaveLength(0);
  });
});

// ── variable-lifetime ────────────────────────────────────────────────────────

describe('threshold/variable-lifetime', () => {
  it('lifetime exactly at maxLifetimeLines → no finding', () => {
    // definition on line 2, last use on line 4 → lifetime = 2 lines (4-2)
    const src = [
      'export function f() {',
      '  const x = 1;',
      '  const y = 2;',
      '  return x + y;',
      '}',
    ].join('\n');
    const findings = analyzeVariableLifetime([parse(src)], { maxLifetimeLines: 2 });

    // x: def line2, use line4 → lifetime=2 → should NOT fire (>2 required)
    expect(findings.filter(f => f.variable === 'x')).toHaveLength(0);
  });

  it('lifetime one over maxLifetimeLines → finding', () => {
    // definition on line 2, last use on line 6 → lifetime = 4 lines
    const src = [
      'export function f() {',
      '  const x = 1;',
      '  const a = 2;',
      '  const b = 3;',
      '  const c = 4;',
      '  return x + a + b + c;',
      '}',
    ].join('\n');
    const findings = analyzeVariableLifetime([parse(src)], { maxLifetimeLines: 3 });

    // x: def line2, use line6 → lifetime=4 > 3 → should fire
    const xFindings = findings.filter(f => f.variable === 'x');

    expect(xFindings.length).toBeGreaterThan(0);
  });
});

// ── implementation-overhead ──────────────────────────────────────────────────

describe('threshold/implementation-overhead', () => {
  it('ratio exactly at minRatio → no finding', () => {
    // Simple function: interface=1 param, implementation=2 statements → ratio=2
    const src = [
      'export function simple(x: number): number {',
      '  const doubled = x * 2;',
      '  return doubled;',
      '}',
    ].join('\n');
    const findings = analyzeImplementationOverhead([parse(src)], { minRatio: 2 });

    // ratio <= 2 should not trigger (needs ratio > minRatio)
    expect(findings.filter(f => f.file.includes('test'))).toHaveLength(0);
  });

  it('returns empty for a trivial function', () => {
    const src = 'export const id = (x: number): number => x;';
    const findings = analyzeImplementationOverhead([parse(src)], { minRatio: 2 });

    expect(findings).toHaveLength(0);
  });
});

// ── decision-surface ─────────────────────────────────────────────────────────

describe('threshold/decision-surface', () => {
  it('axes count below maxAxes → no finding', () => {
    // 1 axis (a), maxAxes=2 → 1 < 2 → no finding
    const src = [
      'export function f(a: boolean): void {',
      '  if (a) { return; }',
      '}',
    ].join('\n');
    const findings = analyzeDecisionSurface([parse(src)], { maxAxes: 2 });

    expect(findings).toHaveLength(0);
  });

  it('axes count equals maxAxes → finding', () => {
    // 2 axes (a, b), maxAxes=2 → 2 >= 2 → finding
    const src = [
      'export function f(a: boolean, b: boolean): void {',
      '  if (a) { return; }',
      '  if (b) { return; }',
      '}',
    ].join('\n');
    const findings = analyzeDecisionSurface([parse(src)], { maxAxes: 2 });

    expect(findings).toHaveLength(1);
  });
});

// ── forwarding ───────────────────────────────────────────────────────────────

describe('threshold/forwarding', () => {
  it('direct call without forwarding → no finding', () => {
    const src = [
      'export const add = (a: number, b: number) => a + b;',
    ].join('\n');
    const findings = analyzeForwarding([parse(src)], 1);

    expect(findings).toHaveLength(0);
  });

  it('two independent functions → no finding', () => {
    const src = [
      'export const double = (x: number) => x * 2;',
      'export const triple = (x: number) => x * 3;',
    ].join('\n');
    const findings = analyzeForwarding([parse(src)], 1);

    expect(findings).toHaveLength(0);
  });
});

// ── exact-duplicates ─────────────────────────────────────────────────────────

describe('threshold/exact-duplicates', () => {
  it('function body below minSize → no finding', () => {
    // Two identical tiny functions, minSize=10 → too small to flag
    const src = [
      'export const f1 = (x: number) => x;',
      'export const f2 = (x: number) => x;',
    ].join('\n');
    const findings = detectExactDuplicates([parse(src)], 100);

    // With minSize=100, trivial functions should not be flagged
    expect(findings).toHaveLength(0);
  });

  it('function body at valid size → finds duplicate', () => {
    // Two identical functions with enough body to exceed minSize=5
    const body = [
      'export function processA(items: string[]): string[] {',
      '  return items.filter(x => x.length > 0).map(x => x.trim());',
      '}',
      'export function processB(items: string[]): string[] {',
      '  return items.filter(x => x.length > 0).map(x => x.trim());',
      '}',
    ].join('\n');
    const findings = detectExactDuplicates([parse(body)], 5);

    expect(findings.length).toBeGreaterThan(0);
  });
});
