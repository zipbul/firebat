import { describe, expect, it } from 'bun:test';

import { FIREBAT_CODE_CATALOG } from './diagnostic-aggregator';

// ── barrel-surgery (settled definition) — C3: D18 catalog think-text contracts ──
// PLAN-barrel-surgery.md D18: catalog remedy text is rewritten as part of the
// surgery so agents converge on barrel-first fixes instead of round-tripping
// (F5: BARREL_CROSS_MODULE_REEXPORT currently tells agents to "import
// directly from the original source module" — i.e. instructs them to CREATE
// a deep import to fix a cross-module-reexport finding, an active
// ping-pong generator between the two detectors). These assertions lock the
// POST-surgery text and are RED until Phase 2 rewrites the catalog entries —
// no existing test file asserted BARREL_* catalog string contents, so this
// file is new (created next to diagnostic-aggregator.ts per its own
// `catalog-reference-parity.spec.ts` / `diagnostic-aggregator.spec.ts`
// sibling-file convention).

describe('FIREBAT_CODE_CATALOG — barrel D18 string contracts', () => {
  // F3 (adversarial review, agent ping-pong docs): the pre-surgery think text
  // told agents "if all symbols are consumed, the wildcard is justified —
  // stop, no action needed" and assumed an index.ts file. Post-surgery
  // contract: bare `export *` is UNCONDITIONALLY a finding (the enumerability
  // clause), in any file — there is no "justified" escape. The remedy is to
  // enumerate the exported names and convert to named re-exports, or use
  // `export * as ns from` when a single namespace name is intended.
  it('BARREL_EXPORT_STAR think converts to named re-exports and has no "no action needed" escape', () => {
    const think = FIREBAT_CODE_CATALOG.BARREL_EXPORT_STAR.think.join(' ');

    expect(think).toContain('named re-exports');
    expect(think).not.toContain('no action needed');
  });

  it('BARREL_CROSS_MODULE_REEXPORT think warns never to import the internal file directly', () => {
    const think = FIREBAT_CODE_CATALOG.BARREL_CROSS_MODULE_REEXPORT.think.join(' ');

    expect(think).toContain('never import the internal file directly');
  });

  it('BARREL_DEEP_IMPORT think warns never to restore the deep import', () => {
    const think = FIREBAT_CODE_CATALOG.BARREL_DEEP_IMPORT.think.join(' ');

    expect(think).toContain('never restore the deep import');
  });

  it('BARREL_MISSING_INDEX think describes demand-driven semantics', () => {
    const think = FIREBAT_CODE_CATALOG.BARREL_MISSING_INDEX.think.join(' ');

    expect(think).toContain('demand');
  });

  it('DIAG_CIRCULAR_DEPENDENCY think warns never to resolve a cycle by deep-importing', () => {
    const think = FIREBAT_CODE_CATALOG.DIAG_CIRCULAR_DEPENDENCY.think.join(' ');

    expect(think).toContain('never resolve a cycle by deep-importing');
  });
});
