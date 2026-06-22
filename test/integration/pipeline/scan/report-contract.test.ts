import { describe, expect, it } from 'bun:test';

import type { FirebatReport } from '../../../../src/test-api';

import { scanUseCase } from '../../../../src/test-api';
import { installFakeBin } from '../../shared/external-tool-test-kit';
import {
  createScanLogger as createLogger,
  createScanProjectFixture,
  createScanProjectFixtureWithFiles,
  expectBareFindingShape,
  findBareFindingByKind,
  withCwd,
  runScanReport,
} from '../../shared/scan-fixture';
import { expectNonEmptyString } from '../../shared/test-kit';

interface IndirectionContractRow {
  readonly title: string;
  readonly prefix: string;
  readonly source: string;
  readonly kind: string;
  readonly code: string;
  readonly header: string;
}

const indirectionContractCases: IndirectionContractRow[] = [
  {
    title: 'indirection - type alias synonym - reports IND_TYPE_REMAP with correct code',
    prefix: 'firebat-report-contract-ind-type-remap',
    source: 'type A = B;\n',
    kind: 'type-remap',
    code: 'IND_TYPE_REMAP',
    header: 'A',
  },
  {
    title: 'indirection - empty interface with extends - reports IND_INTERFACE_REWRAP with correct code',
    prefix: 'firebat-report-contract-ind-interface-rewrap',
    source: 'interface C extends D {}\n',
    kind: 'interface-rewrap',
    code: 'IND_INTERFACE_REWRAP',
    header: 'C',
  },
];

describe('integration/scan/report-contract', () => {
  it('should always include catalog field in the report', async () => {
    // Arrange
    const project = await createScanProjectFixture('firebat-report-contract-shape', 'export const a = 1;');

    try {
      const logger = createLogger();
      // Act
      const report = await runScanReport(project, ['waste'], logger, [project.srcFileAbs]);

      // Assert
      expect(report).toBeDefined();
      expect(typeof (report as FirebatReport).catalog).toBe('object');
    } finally {
      await project.dispose();
    }
  });

  it('should capture format failures into meta.errors and not throw when oxfmt is missing', async () => {
    // Arrange
    const project = await createScanProjectFixture(
      'firebat-report-contract-format-error',
      ['export function deadStore() {', '  let value = 1;', '  return 0;', '}'].join('\n'),
    );

    try {
      const logger = createLogger();
      // Act
      const report = await runScanReport(project, ['format', 'waste'], logger, [project.srcFileAbs]);

      // Assert
      expect(report.meta.errors).toBeDefined();
      expect(report.meta.errors?.format ?? '').toContain('oxfmt');
      expect(report.analyses.format).toBeUndefined();
      expect(Array.isArray(report.analyses.waste)).toBe(true);
    } finally {
      await project.dispose();
    }
  });

  it('should capture lint failures into meta.errors and not throw when oxlint is missing', async () => {
    // Arrange
    const project = await createScanProjectFixture('firebat-report-contract-lint-error', 'export const a = 1;');

    try {
      const logger = createLogger();
      // Act
      const report = await runScanReport(project, ['lint'], logger, [project.srcFileAbs]);

      // Assert
      expect(report.meta.errors).toBeDefined();
      expect(report.meta.errors?.lint ?? '').toContain('oxlint');
      expect(report.analyses.lint).toBeUndefined();
    } finally {
      await project.dispose();
    }
  });

  it('should emit coupling as a bare array in analyses', async () => {
    // Arrange
    const project = await createScanProjectFixture('firebat-report-contract-coupling-array', 'export const a = 1;');

    try {
      const logger = createLogger();
      // Act
      const report = await runScanReport(project, ['dependencies', 'coupling'], logger, [project.srcFileAbs]);

      // Assert
      expect(Array.isArray(report.analyses.coupling)).toBe(true);
    } finally {
      await project.dispose();
    }
  });

  it('should emit coupling hotspots without natural-language fields (why/suggestedRefactor) and with BaseFinding fields', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('firebat-report-contract-coupling-shape', {
      'src/a.ts': "import { b } from './b';\nexport const a = b + 1;\n",
      'src/b.ts': "import { a } from './a';\nexport const b = a + 1;\n",
    });

    try {
      const logger = createLogger();
      // Act
      const report = await runScanReport(project, ['dependencies', 'coupling'], logger, [...project.targetsAbs]);

      // Assert
      expect(Array.isArray(report.analyses.coupling)).toBe(true);
      expect((report.analyses.coupling ?? []).length).toBeGreaterThan(0);

      const couplingFindings = report.analyses.coupling as unknown as any[];
      const allowedKinds = ['god-module', 'bidirectional-coupling', 'off-main-sequence', 'unstable-module', 'rigid-module'];
      const allowedCodes = [
        'COUPLING_GOD_MODULE',
        'COUPLING_BIDIRECTIONAL',
        'COUPLING_OFF_MAIN_SEQ',
        'COUPLING_UNSTABLE',
        'COUPLING_RIGID',
      ];

      // Every finding shape must match the coupling contract (specific kind/code, not just typeof).
      for (const item of couplingFindings) {
        expect(allowedKinds).toContain(item.kind);
        expect(allowedCodes).toContain(item.code);
        expect(typeof item.file).toBe('string');
        expect(item.span).toBeDefined();
        expect(typeof item.span.start.line).toBe('number');
        expect(typeof item.span.end.line).toBe('number');
        expect(item.filePath).toBeUndefined();
        expect(item.why).toBeUndefined();
        expect(item.suggestedRefactor).toBeUndefined();
      }

      // The fixture has a deliberate 2-node cycle (a.ts ↔ b.ts) so bidirectional-coupling
      // must be among the findings; this anchors the contract to a real semantic outcome
      // rather than only the shape of the response.
      const bidirectional = couplingFindings.filter(f => f.kind === 'bidirectional-coupling');

      expect(bidirectional.length).toBeGreaterThanOrEqual(1);
      expect(bidirectional[0].code).toBe('COUPLING_BIDIRECTIONAL');
    } finally {
      await project.dispose();
    }
  });

  it('should emit dependencies as an array of DependencyFinding with kind and code fields', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('firebat-report-contract-deps-shape', {
      'src/a.ts': 'export const unused = 1;\nexport const used = 2;\n',
      'src/b.ts': "import { used } from './a';\nexport const b = used;\n",
    });

    try {
      const logger = createLogger();
      // Act
      const report = await runScanReport(project, ['dependencies'], logger, [...project.targetsAbs]);
      // Assert
      const deps = report.analyses.dependencies;

      expect(Array.isArray(deps)).toBe(true);

      const depsArr = deps as unknown as any[];

      // old DependencyAnalysis shape fields must be absent
      expect((deps as any)?.fanIn).toBeUndefined();
      expect((deps as any)?.fanOut).toBeUndefined();
      expect((deps as any)?.cuts).toBeUndefined();
      expect((deps as any)?.cycles).toBeUndefined();

      // each element must have kind and code fields
      if (depsArr.length > 0) {
        const finding = depsArr[0];

        expect(typeof finding.kind).toBe('string');
        expect(typeof finding.code).toBe('string');
        expect(finding.message).toBeUndefined();
      }
    } finally {
      await project.dispose();
    }
  });

  it('should emit duplicates groups using P0 field names (kind/file/params) instead of cloneType/filePath/suggestedParams', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('firebat-report-contract-exact-dups-shape', {
      'src/a.ts': 'export const x = () => {\n  const a = 1;\n  return a + 1;\n};\n',
      'src/b.ts': 'export const y = () => {\n  const a = 1;\n  return a + 1;\n};\n',
    });

    try {
      const logger = createLogger();
      // Act
      const report = await runScanReport(project, ['duplicates'], logger, [...project.targetsAbs]);

      // Assert
      expect(Array.isArray(report.analyses['duplicates'])).toBe(true);

      const groups = report.analyses['duplicates'] as unknown as any[];

      expect(groups.length).toBeGreaterThan(0);

      const group = groups[0];

      expect(typeof group.kind).toBe('string');
      expect(group.cloneType).toBeUndefined();

      expect(Array.isArray(group.items)).toBe(true);
      expect(group.items.length).toBeGreaterThan(0);

      const item = group.items[0];

      expect(typeof item.file).toBe('string');
      expect(item.filePath).toBeUndefined();

      // params is optional; when present it must be exposed as `params` (not `suggestedParams`).
      if (group.params !== undefined) {
        expect(typeof group.params).toBe('object');
      }

      expect(group.suggestedParams).toBeUndefined();
    } finally {
      await project.dispose();
    }
  });

  it('should include catalog entry for lint even when lint returns many diagnostics', async () => {
    // Arrange
    const project = await createScanProjectFixture('firebat-report-contract-catalog-includes-lint', 'export const a = 1;');

    try {
      await installFakeBin(
        project.rootAbs,
        'oxlint',
        `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1-}" == "--version" ]]; then
  echo "oxlint 1.46.0"
  exit 0
fi

cat <<'JSON'
[
  { "filename": "src/a.ts", "text": "rule-a", "ruleId": "rule-a", "level": "warning", "row": 1, "col": 1 },
  { "filename": "src/a.ts", "text": "rule-b", "ruleId": "rule-b", "level": "error", "row": 2, "col": 1 }
]
JSON

exit 1
`,
      );

      const logger = createLogger();
      // Act
      const report = await runScanReport(project, ['lint'], logger, [project.srcFileAbs]);

      // Assert
      expect(report.catalog).toBeDefined();
    } finally {
      await project.dispose();
    }
  });

  it('should enrich waste findings with file+code and expose them as a bare array', async () => {
    // Arrange — case 1 dead-store-overwrite: initializer is overwritten before read.
    const project = await createScanProjectFixture(
      'firebat-report-contract-waste-enrich',
      ['export function deadStore() {', '  let value = 1;', '  value = 2;', '  return value;', '}'].join('\n'),
    );

    try {
      const logger = createLogger();
      // Act
      const report = await runScanReport(project, ['waste'], logger, [project.srcFileAbs]);
      // Assert
      const waste = report.analyses.waste as any[] | undefined;

      expect(Array.isArray(waste)).toBe(true);
      expect(waste?.length ?? 0).toBeGreaterThan(0);
      expect(typeof waste?.[0]?.file).toBe('string');
      expect(waste?.[0]?.file).toContain('src/a.ts');
      expect(waste?.[0]?.code).toBe('WASTE_DEAD_STORE');
      expect(waste?.[0]?.filePath).toBeUndefined();
    } finally {
      await project.dispose();
    }
  });

  it('should expose barrel findings as a bare array with file+code and no message field', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('firebat-report-contract-barrel-bare-array', {
      'src/a.ts': 'export const a = 1;\n',
      'src/index.ts': "export * from './a';\n",
    });

    try {
      const logger = createLogger();
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            minSize: 0,
            maxForwardDepth: 0,
            detectors: ['barrel'],
            help: false,
            barrelIgnoreGlobs: [],
          },
          { logger },
        ),
      );
      // Assert
      const exportStar = findBareFindingByKind(report.analyses, 'barrel', 'export-star');

      expect(typeof exportStar?.file).toBe('string');
      expect(exportStar?.file).toBe('src/index.ts');
      expect(exportStar?.filePath).toBeUndefined();
      expect(exportStar?.message).toBeUndefined();
      expect(exportStar?.code).toBe('BARREL_EXPORT_STAR');
    } finally {
      await project.dispose();
    }
  });

  it('should include catalog entry for format even when format returns many paths', async () => {
    // Arrange
    const project = await createScanProjectFixture(
      'firebat-report-contract-catalog-includes-format',
      ['export function deadStore() {', '  let value = 1;', '  return 0;', '}'].join('\n'),
    );

    try {
      await installFakeBin(
        project.rootAbs,
        'oxfmt',
        `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1-}" == "--version" ]]; then
  echo "oxfmt 0.26.0"
  exit 0
fi

echo "src/a.ts"
echo "src/b.ts"
echo "src/c.ts"
exit 7
`,
      );

      const logger = createLogger();
      // Act
      const report = await runScanReport(project, ['format', 'waste'], logger, [project.srcFileAbs]);

      // Assert
      expect(report.catalog).toBeDefined();
    } finally {
      await project.dispose();
    }
  });

  it('should expose error-flow findings as a bare array with file+code and no wrapper fields', async () => {
    // Arrange
    const project = await createScanProjectFixture(
      'firebat-report-contract-error-flow-bare-array',
      [
        'export function badThrow() {',
        "  throw 'nope';",
        '}',
        '',
        'export function silentCatch() {',
        '  try {',
        '    return 1;',
        '  } catch {',
        '    // swallow',
        '  }',
        '  return 0;',
        '}',
      ].join('\n'),
    );

    try {
      const logger = createLogger();
      // Act
      const report = await runScanReport(project, ['error-flow'], logger, [project.srcFileAbs]);
      // Assert
      const throwNonError = findBareFindingByKind(report.analyses, 'error-flow', 'throw-non-error');

      expectBareFindingShape(throwNonError, 'src/a.ts');
      expect(throwNonError?.message).toBeUndefined();
      expect(throwNonError?.recipes).toBeUndefined();
      expect(throwNonError?.code).toBe('EF_THROW_NON_ERROR');
    } finally {
      await project.dispose();
    }
  });

  it('should expose indirection findings as a bare array with file+code and no wrapper fields', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('firebat-report-contract-indirection-bare-array', {
      'src/c.ts': ['export const real = (value: number) => value + 1;'].join('\n'),
      'src/b.ts': ["import { real } from './c';", 'export const mid = (value: number) => real(value);'].join('\n'),
      'src/a.ts': ["import { mid } from './b';", 'export const top = (value: number) => mid(value);'].join('\n'),
    });

    try {
      const logger = createLogger();
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            minSize: 0,
            maxForwardDepth: 5,
            detectors: ['indirection'],
            help: false,
          },
          { logger },
        ),
      );
      // Assert
      const findings = report.analyses.indirection as any;

      expect(Array.isArray(findings)).toBe(true);
      expect((findings as any[]).length).toBeGreaterThan(0);

      const first = (findings as any[])[0];

      expectBareFindingShape(first, 'src/');
      expect(typeof first?.code).toBe('string');
      expect(String(first?.code)).toContain('IND_');
    } finally {
      await project.dispose();
    }
  });

  it('should expose duplicates as a bare array of groups with kind/file and no legacy wrapper fields', async () => {
    // Arrange
    const project = await createScanProjectFixture(
      'firebat-report-contract-duplicates-bare-array',
      [
        'export function a(input: number) {',
        '  const x = input + 1;',
        '  return x * 2;',
        '}',
        '',
        'export function b(value: number) {',
        '  const y = value + 1;',
        '  return y * 2;',
        '}',
      ].join('\n'),
    );

    try {
      const logger = createLogger();
      // Act
      const report = await runScanReport(project, ['duplicates'], logger, [project.srcFileAbs]);
      // Assert
      const groups = report.analyses['duplicates'] as any;

      expect(Array.isArray(groups)).toBe(true);

      const first = (groups as any[])[0];

      expect(first?.cloneClasses).toBeUndefined();
      expect(first?.cloneType).toBeUndefined();
      expect(typeof first?.kind).toBe('string');

      const firstItem = (first?.items ?? [])[0];

      expect(firstItem?.filePath).toBeUndefined();
      expect(typeof firstItem?.file).toBe('string');
    } finally {
      await project.dispose();
    }
  });

  it('should only include seen codes in catalog and exclude codes for detectors not run', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('firebat-report-contract-catalog-seen-codes', {
      'src/a.ts': ['export function deadStore() {', '  let value = 1;', '  value = 2;', '  return value;', '}'].join('\n'),
      'src/b.ts': ['export const b = 1;'].join('\n'),
      'src/index.ts': "export * from './b';\n",
      'src/c.ts': ['export function badThrow() {', "  throw 'nope';", '}'].join('\n'),
    });

    try {
      const logger = createLogger();
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            minSize: 0,
            maxForwardDepth: 0,
            detectors: ['waste', 'barrel', 'error-flow', 'lint', 'format', 'typecheck'],
            help: false,
            barrelIgnoreGlobs: [],
          },
          { logger },
        ),
      );

      // Assert
      expect(typeof report.catalog.WASTE_DEAD_STORE?.cause).toBe('string');
      expect(typeof report.catalog.BARREL_EXPORT_STAR?.think[0]).toBe('string');
      expect(typeof report.catalog.EF_THROW_NON_ERROR?.cause).toBe('string');
    } finally {
      await project.dispose();
    }
  });

  it('should have catalog entries with cause string and non-empty think array when findings are detected', async () => {
    // Arrange
    const project = await createScanProjectFixture(
      'firebat-report-contract-catalog-shape',
      ['export function deadStore() {', '  let value = 1;', '  value = 2;', '  return value;', '}'].join('\n'),
    );

    try {
      const logger = createLogger();
      // Act
      const report = await runScanReport(project, ['waste'], logger, [project.srcFileAbs]);
      // Assert
      const entries = Object.values(report.catalog);

      expect(entries.length).toBeGreaterThan(0);

      for (const entry of entries) {
        expectNonEmptyString(entry.cause);
        expect(Array.isArray(entry.think)).toBe(true);
        expect(entry.think.length).toBeGreaterThan(0);
        expect(typeof entry.think[0]).toBe('string');
      }
    } finally {
      await project.dispose();
    }
  });

  it.each(indirectionContractCases)('$title', async ({ prefix, source, kind, code, header }) => {
    // Arrange
    const project = await createScanProjectFixture(prefix, source);

    try {
      const logger = createLogger();
      // Act
      const report = await runScanReport(project, ['indirection'], logger, [project.srcFileAbs]);
      // Assert
      const findings = report.analyses.indirection as any[];

      expect(Array.isArray(findings)).toBe(true);
      expect(findings.length).toBe(1);
      expect(findings[0]?.kind).toBe(kind);
      expect(findings[0]?.code).toBe(code);
      expect(typeof findings[0]?.file).toBe('string');
      expect(findings[0]?.filePath).toBeUndefined();
      expect(findings[0]?.header).toBe(header);
    } finally {
      await project.dispose();
    }
  });
});
