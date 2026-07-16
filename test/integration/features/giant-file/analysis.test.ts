import { describe, expect, it } from 'bun:test';

import { expectBaseFinding, expectNoOptionalFindingFields, scanDetectorFindings } from '../../shared/scan-fixture';

const repeatExports = (count: number, template: (i: number) => string): string => {
  return Array.from({ length: count }, (_, i) => template(i)).join('\n');
};

interface PositiveCase {
  readonly title: string;
  readonly prefix: string;
  readonly files: Readonly<Record<string, string>>;
}

const positiveCases: PositiveCase[] = [
  {
    title: 'a single file exceeds the configured maxLines threshold',
    prefix: 'giant-file-1',
    files: {
      '.firebatrc.jsonc': '{\n  "features": { "giant-file": { "maxLines": 1000 } }\n}',
      'src/a.ts': repeatExports(2000, i => `export const x${i} = ${i};`),
    },
  },
  {
    title: 'file is large due to many small exports',
    prefix: 'giant-file-2',
    files: {
      'src/a.ts': repeatExports(1500, i => `export const f${i} = () => ${i};`),
    },
  },
];

describe('integration/giant-file', () => {
  it.each(positiveCases)('should report giant-file when $title', async ({ prefix, files }) => {
    // Act
    const list = await scanDetectorFindings(prefix, 'giant-file', files);

    // Assert
    expect(list.length).toBeGreaterThan(0);
    expectBaseFinding(list[0], 'giant-file');
  });

  it('should include metrics in giant-file findings when reported', async () => {
    // Act
    const list = await scanDetectorFindings('giant-file-3', 'giant-file', {
      'src/a.ts': repeatExports(1200, i => `export const x${i} = ${i};`),
    });

    // Assert
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]?.metrics).toBeDefined();
    expect(typeof list[0]?.metrics).toBe('object');
  });

  it('should not emit natural-language fields in giant-file findings', async () => {
    // Act
    const list = await scanDetectorFindings('giant-file-4', 'giant-file', {
      'src/a.ts': repeatExports(1100, i => `export const x${i} = ${i};`),
    });

    // Assert
    for (const item of list) {
      expectBaseFinding(item, 'giant-file');
      expectNoOptionalFindingFields(item);
    }
  });

  it('should report giant-file findings with BaseFinding fields', async () => {
    // Act
    const list = await scanDetectorFindings('giant-file-5', 'giant-file', {
      'src/a.ts': repeatExports(1300, i => `export const x${i} = ${i};`),
    });

    // Assert
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]?.kind).toBe('giant-file');
    expect(typeof list[0]?.file).toBe('string');
    expect(list[0]?.span).toBeDefined();
    expect(list[0]?.code).toBeDefined();
  });

  it('should not report giant-file when line count does not exceed maxLines threshold', async () => {
    // Act
    const list = await scanDetectorFindings('giant-file-neg-1', 'giant-file', {
      '.firebatrc.jsonc': '{\n  "features": { "giant-file": { "maxLines": 1000 } }\n}',
      'src/a.ts': repeatExports(50, i => `export const x${i} = ${i};`),
    });

    // Assert
    expect(list.length).toBe(0);
  });
});

// ── giant-file surgery (PLAN-giant-file-surgery.md D1/D2) — resolution site ──
// The effective maxLines budget is resolved at scan wiring (scan.usecase.ts,
// `featureOptions(giantFileCfg)?.maxLines ?? 1000`), not at arg-parse — these
// tests exercise the real scanUseCase pipeline (via scanDetectorFindings) with
// an actual .firebatrc.jsonc so the resolved value (and its provenance) is
// observed end-to-end, not just unit-tested against the analyzer directly.

interface MaxLinesResolutionCase {
  readonly title: string;
  readonly configJson?: string;
  readonly lineCount: number;
  readonly expectFinding: boolean;
}

const maxLinesResolutionCases: MaxLinesResolutionCase[] = [
  {
    title: 'PIN: absent config, exactly 1000 lines → no finding (default=1000, K boundary)',
    lineCount: 1000,
    expectFinding: false,
  },
  {
    title: 'PIN: absent config, 1001 lines → finding (default=1000, W boundary)',
    lineCount: 1001,
    expectFinding: true,
  },
  {
    title: 'PIN: giant-file: true, exactly 1000 lines → no finding (true resolves to default 1000)',
    configJson: '{\n  "features": { "giant-file": true }\n}',
    lineCount: 1000,
    expectFinding: false,
  },
  {
    title: 'PIN: giant-file: true, 1001 lines → finding',
    configJson: '{\n  "features": { "giant-file": true }\n}',
    lineCount: 1001,
    expectFinding: true,
  },
  {
    title: 'PIN: giant-file: {}, exactly 1000 lines → no finding ({} resolves to default 1000)',
    configJson: '{\n  "features": { "giant-file": {} }\n}',
    lineCount: 1000,
    expectFinding: false,
  },
  {
    title: 'PIN: giant-file: {}, 1001 lines → finding',
    configJson: '{\n  "features": { "giant-file": {} }\n}',
    lineCount: 1001,
    expectFinding: true,
  },
  {
    title: 'PIN: maxLines: 1500 override, exactly 1500 lines → no finding (configured N, not the 1000 default)',
    configJson: '{\n  "features": { "giant-file": { "maxLines": 1500 } }\n}',
    lineCount: 1500,
    expectFinding: false,
  },
  {
    title: 'PIN: maxLines: 1500 override, 1501 lines → finding',
    configJson: '{\n  "features": { "giant-file": { "maxLines": 1500 } }\n}',
    lineCount: 1501,
    expectFinding: true,
  },
];

describe('integration/giant-file — resolution site (maxLines default vs configured)', () => {
  it.each(maxLinesResolutionCases)('$title', async ({ configJson, lineCount, expectFinding }) => {
    // Arrange
    const files: Record<string, string> = {
      'src/a.ts': repeatExports(lineCount, i => `export const x${i} = ${i};`),
    };

    if (configJson !== undefined) {
      files['.firebatrc.jsonc'] = configJson;
    }

    // Act
    const list = await scanDetectorFindings('giant-file-resolve', 'giant-file', files);

    // Assert
    expect(list.length).toBe(expectFinding ? 1 : 0);
  });
});

// ── giant-file surgery D2 — `metrics.defaulted` provenance (RED until P2) ───
// RED today: GiantFileMetrics has no `defaulted` field and scan.usecase.ts
// never sets one, so `list[0]?.metrics?.defaulted` reads `undefined` in every
// case below (neither `.toBe(true)` nor `.toBe(false)` is satisfied).
describe('integration/giant-file — metrics.defaulted provenance', () => {
  it('RED: metrics.defaulted is true when the default budget is used (no config)', async () => {
    // Act
    const list = await scanDetectorFindings('giant-file-defaulted-true', 'giant-file', {
      'src/a.ts': repeatExports(1001, i => `export const x${i} = ${i};`),
    });

    // Assert
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]?.metrics?.defaulted).toBe(true);
  });

  it('RED: metrics.defaulted is false when maxLines is explicitly configured, even at the same numeric value as the default (1000)', async () => {
    // Act
    const list = await scanDetectorFindings('giant-file-defaulted-explicit-1000', 'giant-file', {
      '.firebatrc.jsonc': '{\n  "features": { "giant-file": { "maxLines": 1000 } }\n}',
      'src/a.ts': repeatExports(1001, i => `export const x${i} = ${i};`),
    });

    // Assert
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]?.metrics?.defaulted).toBe(false);
  });

  it('RED: metrics.defaulted is false when maxLines is configured to a non-default value', async () => {
    // Act
    const list = await scanDetectorFindings('giant-file-defaulted-explicit-1500', 'giant-file', {
      '.firebatrc.jsonc': '{\n  "features": { "giant-file": { "maxLines": 1500 } }\n}',
      'src/a.ts': repeatExports(1501, i => `export const x${i} = ${i};`),
    });

    // Assert
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]?.metrics?.defaulted).toBe(false);
  });
});
