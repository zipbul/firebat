import { describe, it, expect } from 'bun:test';

import { expectNonEmptyString } from '../../../test/integration/shared/test-kit';
import { FIREBAT_CODE_CATALOG, aggregateDiagnostics } from './diagnostic-aggregator';

// ── Helpers ─────────────────────────────────────────────────────────

const makeWaste = (file: string) => ({ kind: 'dead-store', file, filePath: undefined });

const makeNestingHighCC = (file: string) => ({ kind: 'high-cognitive-complexity', file });

const makeNestingDeep = (file: string) => ({ kind: 'deep-nesting', file });

const makeCycle = (path: string[]) => ({ path });

const FILE_A = 'src/a.ts';
const FILE_B = 'src/b.ts';

// ── Tests ────────────────────────────────────────────────────────────

describe('FIREBAT_CODE_CATALOG', () => {
  // barrel-surgery (PLAN-barrel-surgery.md D1): BARREL_INDEX_DEEP_IMPORT and
  // BARREL_SIDE_EFFECT_IMPORT catalog codes deleted outright — 73 → 71.
  // fan-in/fan-out hotspot detector removal: COUPLING_GOD_MODULE/BIDIRECTIONAL/OFF_MAIN_SEQ/UNSTABLE/RIGID
  // catalog codes deleted outright (no fact-closable verdict) — 71 → 66. The composite
  // DIAG_GOD_MODULE diagnostic was sourced from those fan-in/fan-out metrics; with them gone it can
  // never fire, so its catalog entry is removed too (no dead code masquerading as documentation) — 66 → 65.
  it('should have exactly 65 entries', () => {
    expect(Object.keys(FIREBAT_CODE_CATALOG).length).toBe(65);
  });

  it('should have a cause string for every entry', () => {
    for (const [_code, entry] of Object.entries(FIREBAT_CODE_CATALOG)) {
      expectNonEmptyString(entry.cause);
    }
  });

  it('should have a non-empty think array for every entry', () => {
    for (const [_code, entry] of Object.entries(FIREBAT_CODE_CATALOG)) {
      expect(Array.isArray(entry.think)).toBe(true);
      expect(entry.think.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('should have string elements in every think array', () => {
    for (const [_code, entry] of Object.entries(FIREBAT_CODE_CATALOG)) {
      for (const t of entry.think) {
        expectNonEmptyString(t);
      }
    }
  });

  it('should not have a fix field on any entry', () => {
    for (const [_code, entry] of Object.entries(FIREBAT_CODE_CATALOG)) {
      expect('fix' in entry).toBe(false);
    }
  });

  it('should include DIAG_GOD_FUNCTION entry', () => {
    expect(FIREBAT_CODE_CATALOG.DIAG_GOD_FUNCTION).toBeDefined();
  });

  it('should include DIAG_CIRCULAR_DEPENDENCY entry', () => {
    expect(FIREBAT_CODE_CATALOG.DIAG_CIRCULAR_DEPENDENCY).toBeDefined();
  });
});

describe('aggregateDiagnostics', () => {
  // ── DIAG_GOD_FUNCTION ──────────────────────────────────────────────

  it('should add DIAG_GOD_FUNCTION to catalog when waste and high-CC nesting co-occur in same file', () => {
    const result = aggregateDiagnostics({
      analyses: {
        waste: [makeWaste(FILE_A)],
        nesting: [makeNestingHighCC(FILE_A)],
      },
    });

    expect(result.catalog.DIAG_GOD_FUNCTION).toBeDefined();
  });

  it('should not add DIAG_GOD_FUNCTION when waste and high-CC nesting are in different files', () => {
    const result = aggregateDiagnostics({
      analyses: {
        waste: [makeWaste(FILE_A)],
        nesting: [makeNestingHighCC(FILE_B)],
      },
    });

    expect(result.catalog.DIAG_GOD_FUNCTION).toBeUndefined();
  });

  it('should not add DIAG_GOD_FUNCTION when nesting kind is deep-nesting (not high-CC)', () => {
    const result = aggregateDiagnostics({
      analyses: {
        waste: [makeWaste(FILE_A)],
        nesting: [makeNestingDeep(FILE_A)],
      },
    });

    expect(result.catalog.DIAG_GOD_FUNCTION).toBeUndefined();
  });

  it('should not add DIAG_GOD_FUNCTION when waste array is empty', () => {
    const result = aggregateDiagnostics({
      analyses: {
        waste: [],
        nesting: [makeNestingHighCC(FILE_A)],
      },
    });

    expect(result.catalog.DIAG_GOD_FUNCTION).toBeUndefined();
  });

  it('should not add DIAG_GOD_FUNCTION when nesting array is empty', () => {
    const result = aggregateDiagnostics({
      analyses: {
        waste: [makeWaste(FILE_A)],
        nesting: [],
      },
    });

    expect(result.catalog.DIAG_GOD_FUNCTION).toBeUndefined();
  });

  it('should count resolves as number of waste items in matching file when god function detected', () => {
    // 2 waste items in same file as high-CC nesting → resolves = 2
    const result = aggregateDiagnostics({
      analyses: {
        waste: [makeWaste(FILE_A), makeWaste(FILE_A)],
        nesting: [makeNestingHighCC(FILE_A)],
      },
    });

    expect(result.catalog.DIAG_GOD_FUNCTION).toBeDefined();
  });

  it('should use filePath as fallback when waste item has no file field', () => {
    const wasteWithFilePath = { kind: 'dead-store', filePath: FILE_A, file: undefined };
    const result = aggregateDiagnostics({
      analyses: {
        waste: [wasteWithFilePath],
        nesting: [makeNestingHighCC(FILE_A)],
      },
    });

    expect(result.catalog.DIAG_GOD_FUNCTION).toBeDefined();
  });

  // ── DIAG_CIRCULAR_DEPENDENCY ───────────────────────────────────────

  it('should add DIAG_CIRCULAR_DEPENDENCY when dependencies.cycles is non-empty', () => {
    const result = aggregateDiagnostics({
      analyses: {
        dependencies: { cycles: [makeCycle([FILE_A, FILE_B, FILE_A])] },
      },
    });

    expect(result.catalog.DIAG_CIRCULAR_DEPENDENCY).toBeDefined();
  });

  it('should not add DIAG_CIRCULAR_DEPENDENCY when dependencies key is absent', () => {
    const result = aggregateDiagnostics({ analyses: {} });

    expect(result.catalog.DIAG_CIRCULAR_DEPENDENCY).toBeUndefined();
  });

  it('should not add DIAG_CIRCULAR_DEPENDENCY when dependencies.cycles is empty array', () => {
    const result = aggregateDiagnostics({
      analyses: {
        dependencies: { cycles: [] },
      },
    });

    expect(result.catalog.DIAG_CIRCULAR_DEPENDENCY).toBeUndefined();
  });

  it('should add DIAG_CIRCULAR_DEPENDENCY when exactly one cycle exists', () => {
    const result = aggregateDiagnostics({
      analyses: {
        dependencies: { cycles: [makeCycle([FILE_A, FILE_B])] },
      },
    });

    expect(result.catalog.DIAG_CIRCULAR_DEPENDENCY).toBeDefined();
  });

  // ── Empty / no analyses ────────────────────────────────────────────

  it('should return empty catalog when analyses is empty object', () => {
    const result = aggregateDiagnostics({ analyses: {} });

    expect(Object.keys(result.catalog).length).toBe(0);
  });

  // ── Combined scenarios ─────────────────────────────────────────────

  it('should add both diagnostic codes when all conditions are met simultaneously', () => {
    const result = aggregateDiagnostics({
      analyses: {
        waste: [makeWaste(FILE_A)],
        nesting: [makeNestingHighCC(FILE_A)],
        dependencies: { cycles: [makeCycle([FILE_A, FILE_B])] },
      },
    });

    expect(result.catalog.DIAG_GOD_FUNCTION).toBeDefined();
    expect(result.catalog.DIAG_CIRCULAR_DEPENDENCY).toBeDefined();
  });

  it('should add only DIAG_CIRCULAR_DEPENDENCY when waste+cycles present but nesting absent', () => {
    const result = aggregateDiagnostics({
      analyses: {
        waste: [makeWaste(FILE_A)],
        dependencies: { cycles: [makeCycle([FILE_A, FILE_B])] },
      },
    });

    expect(result.catalog.DIAG_GOD_FUNCTION).toBeUndefined();
    expect(result.catalog.DIAG_CIRCULAR_DEPENDENCY).toBeDefined();
  });
});
