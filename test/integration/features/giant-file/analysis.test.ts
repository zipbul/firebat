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

// ── giant-file — resolution site ──────────────────────────────────────────
// The effective maxLines budget is resolved at scan wiring (scan.usecase.ts,
// `featureOptions(giantFileCfg)?.maxLines ?? DEFAULT_MAX_LINES`), not at
// arg-parse — these tests exercise the real scanUseCase pipeline (via
// scanDetectorFindings) with an actual .firebatrc.jsonc so the resolved value
// is observed end-to-end, not just unit-tested against the analyzer directly.

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

// ── detector-local `exclude` glob (giant-file-only, K-direction) ────────────
// Distinct from the GLOBAL scan-set `exclude`, which drops a file from every
// detector: this is the ecosystem test-exemption pattern (eslint overrides),
// scoped to giant-file alone.

describe('integration/giant-file — detector-local exclude glob', () => {
  it('RED: excludes an over-budget file matching the glob while keeping a non-excluded sibling', async () => {
    // Arrange
    const files: Record<string, string> = {
      '.firebatrc.jsonc': '{\n  "features": { "giant-file": { "maxLines": 50, "exclude": ["**/*.spec.ts"] } }\n}',
      'src/a.spec.ts': repeatExports(100, i => `export const x${i} = ${i};`),
      'src/b.ts': repeatExports(100, i => `export const y${i} = ${i};`),
    };

    // Act
    const list = await scanDetectorFindings('giant-file-exclude-1', 'giant-file', files);

    // Assert
    expect(list.length).toBe(1);
    expect(list.some((f: any) => String(f.file).includes('a.spec.ts'))).toBe(false);
    expect(list.some((f: any) => String(f.file).includes('b.ts'))).toBe(true);
  });
});
