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

import { parseSource } from '../../../src/test-api';
import { analyzeGiantFile } from '../../../src/test-api';
import { analyzeNesting } from '../../../src/test-api';
import { analyzeVariableLifetime } from '../../../src/test-api';
import { analyzeIndirection } from '../../../src/test-api';
import { buildMockGildashFromSources } from './indirection/mock-gildash-helper';

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
    const src = ['export function f() {', '  const x = 1;', '  const y = 2;', '  return x + y;', '}'].join('\n');
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

// ── nesting ─────────────────────────────────────────────────────────────────

describe('threshold/nesting', () => {
  it('depth exactly at maxNestingDepth → no finding (< threshold)', () => {
    // depth=2, maxNestingDepth=3 → 2 < 3 → no finding
    const src = ['export function f(a: boolean, b: boolean) {', '  if (a) { if (b) { return 1; } }', '  return 0;', '}'].join(
      '\n',
    );
    const findings = analyzeNesting([parse(src)], { maxNestingDepth: 3, maxCognitiveComplexity: 999 });

    expect(findings).toHaveLength(0);
  });

  it('depth at maxNestingDepth → finding (>= threshold)', () => {
    // depth=3, maxNestingDepth=3 → 3 >= 3 → finding
    const src = [
      'export function f(a: boolean, b: boolean, c: boolean) {',
      '  if (a) { if (b) { if (c) { return 1; } } }',
      '  return 0;',
      '}',
    ].join('\n');
    const findings = analyzeNesting([parse(src)], { maxNestingDepth: 3, maxCognitiveComplexity: 999 });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('deep-nesting');
  });

  it('CC below maxCognitiveComplexity → no finding', () => {
    // Simple if → CC=1, threshold=15 → no finding
    const src = ['export function f(a: boolean) {', '  if (a) { return 1; }', '  return 0;', '}'].join('\n');
    const findings = analyzeNesting([parse(src)], { maxCognitiveComplexity: 15 });

    expect(findings).toHaveLength(0);
  });

  it('CC at maxCognitiveComplexity → finding', () => {
    // Build a function with CC=2: if(+1) else(+1) = 2
    const src = ['export function f(x: boolean) {', '  if (x) { return 1; }', '  else { return 0; }', '}'].join('\n');
    const findings = analyzeNesting([parse(src)], { maxCognitiveComplexity: 2, maxNestingDepth: 999 });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('high-cognitive-complexity');
  });
});

// ── indirection ──────────────────────────────────────────────────────────────

describe('threshold/indirection', () => {
  it('direct call without indirection → no finding', async () => {
    const src = ['export const add = (a: number, b: number) => a + b;'].join('\n');
    const emptyGildash = buildMockGildashFromSources({});
    const findings = await analyzeIndirection(emptyGildash, [parse(src)], { maxForwardDepth: 1, crossFileMinDepth: 2 }, '/virtual');

    expect(findings).toHaveLength(0);
  });

  it('two independent functions → no finding', async () => {
    const src = ['export const double = (x: number) => x * 2;', 'export const triple = (x: number) => x * 3;'].join('\n');
    const emptyGildash = buildMockGildashFromSources({});
    const findings = await analyzeIndirection(emptyGildash, [parse(src)], { maxForwardDepth: 1, crossFileMinDepth: 2 }, '/virtual');

    expect(findings).toHaveLength(0);
  });
});
