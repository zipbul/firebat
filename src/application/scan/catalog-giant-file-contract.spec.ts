import { describe, expect, it } from 'bun:test';

import { FIREBAT_CODE_CATALOG } from './diagnostic-aggregator';

// ── giant-file catalog contract — vocabulary neutralization + split guidance ──
// The neutral verdict is LOAD-BEARING for the default-budget ruling: the
// two-prong criterion's prong 1 (pure-comparison verdict) fails if a defect
// narrative ("too many responsibilities", "oversized", "should be split") is
// attached — a default budget would then be exactly the removed coupling
// detector's failure mode with better metrics. The catalog entry must read as
// a pure budget-exceedance fact. The catalog text is embedded into scan JSON,
// so this is the remedy channel every consumer agent sees.
//
// Scope note: the ban is GIANT_FILE-entry-only — "too many" legitimately
// appears elsewhere (e.g. LIFETIME_LIVENESS_PRESSURE), so this is deliberately
// NOT a catalog-wide ban. The stems ban INDICATIVE verdict claims about the
// file; imperative-conditional remedy guidance is a different register and is
// pinned POSITIVELY below so it cannot be silently simplified away.
const FORBIDDEN_STEMS = /responsibilit|oversized|too many|should be split|wrong/i;

describe('FIREBAT_CODE_CATALOG.GIANT_FILE — vocabulary contract', () => {
  it('cause contains none of the forbidden defect stems', () => {
    expect(FIREBAT_CODE_CATALOG.GIANT_FILE.cause).not.toMatch(FORBIDDEN_STEMS);
  });

  it('think steps contain none of the forbidden defect stems', () => {
    const think = FIREBAT_CODE_CATALOG.GIANT_FILE.think.join(' ');

    expect(think).not.toMatch(FORBIDDEN_STEMS);
  });

  it('think has at least 2 actionable steps', () => {
    expect(FIREBAT_CODE_CATALOG.GIANT_FILE.think.length).toBeGreaterThanOrEqual(2);
  });

  it('cause mentions the line budget (pure budget-exceedance verdict)', () => {
    expect(FIREBAT_CODE_CATALOG.GIANT_FILE.cause.toLowerCase()).toMatch(/budget/);
  });

  it('think pins the cohesive-split guidance (cannot be simplified away)', () => {
    const think = FIREBAT_CODE_CATALOG.GIANT_FILE.think.join(' ');

    expect(think).toMatch(/cohesive seam/i);
  });

  it('think names the mechanical-split anti-patterns', () => {
    const think = FIREBAT_CODE_CATALOG.GIANT_FILE.think.join(' ');

    expect(think).toMatch(/part2|grab-bag/i);
  });

  it('think states that a rescan surfaces the fallout of a careless split', () => {
    const think = FIREBAT_CODE_CATALOG.GIANT_FILE.think.join(' ');

    expect(think.toLowerCase()).toMatch(/rescan/);
  });

  it('think names the DETECTOR-LOCAL exclude precisely (never the ambiguous global glob)', () => {
    const think = FIREBAT_CODE_CATALOG.GIANT_FILE.think.join(' ');

    // The remedy must point at features["giant-file"].exclude — a bare
    // "exclude it by glob" steers agents to the TOP-LEVEL exclude, which drops
    // the file from every detector (coverage loss), not just from giant-file.
    expect(think).toMatch(/features\["giant-file"\]\.exclude/);
    expect(think.toLowerCase()).toMatch(/other detectors/);
  });

  it('think names the test-file exemption convention as the canonical exclude use case', () => {
    const think = FIREBAT_CODE_CATALOG.GIANT_FILE.think.join(' ');

    expect(think).toMatch(/spec|test file/i);
  });
});
