import { describe, expect, it } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { FIREBAT_CODE_CATALOG } from './diagnostic-aggregator';

// ── giant-file surgery (PLAN-giant-file-surgery.md D6) — vocabulary neutralization ──
// D6 is LOAD-BEARING for the default-budget ruling (D1): the two-prong
// criterion's prong 1 (pure-comparison verdict) fails without it — with a
// defect narrative ("too many responsibilities", "oversized", "should be
// split") still attached, a default budget is exactly coupling's failure mode
// with better metrics. The catalog entry must read as a pure budget-exceedance
// fact, and the reference doc subagents actually read must match.
//
// RED today: GIANT_FILE.cause/think and giant-file.md still carry the
// forbidden defect stems (see src/application/scan/diagnostic-aggregator.ts
// and .claude/skills/firebat/references/giant-file.md).
//
// Scope note: the ban is GIANT_FILE-entry-only / this-file-only — "too many"
// legitimately appears elsewhere (e.g. LIFETIME_LIVENESS_PRESSURE), so this is
// deliberately NOT a catalog-wide or repo-wide ban.
const FORBIDDEN_STEMS = /responsibilit|oversized|too many|should be split|wrong/i;

const GIANT_FILE_REF_PATH = path.resolve(
  import.meta.dir,
  '../../../.claude/skills/firebat/references/giant-file.md',
);

describe('FIREBAT_CODE_CATALOG.GIANT_FILE — D6 vocabulary neutralization (giant-file surgery)', () => {
  it('RED: cause contains none of the forbidden defect stems', () => {
    expect(FIREBAT_CODE_CATALOG.GIANT_FILE.cause).not.toMatch(FORBIDDEN_STEMS);
  });

  it('RED: think steps contain none of the forbidden defect stems', () => {
    const think = FIREBAT_CODE_CATALOG.GIANT_FILE.think.join(' ');

    expect(think).not.toMatch(FORBIDDEN_STEMS);
  });

  it('PIN: think has at least 2 actionable steps', () => {
    expect(FIREBAT_CODE_CATALOG.GIANT_FILE.think.length).toBeGreaterThanOrEqual(2);
  });

  it('RED: cause mentions the line budget (pure budget-exceedance verdict, D6 target wording)', () => {
    expect(FIREBAT_CODE_CATALOG.GIANT_FILE.cause.toLowerCase()).toMatch(/budget/);
  });
});

describe('giant-file.md reference doc — D6 vocabulary neutralization (whole-file scan)', () => {
  it('RED: the reference doc contains none of the forbidden defect stems anywhere in the file', () => {
    const markdown = fs.readFileSync(GIANT_FILE_REF_PATH, 'utf8');

    expect(markdown).not.toMatch(FORBIDDEN_STEMS);
  });
});
