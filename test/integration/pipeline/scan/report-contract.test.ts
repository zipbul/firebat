import { describe, expect, it } from 'bun:test';
import * as path from 'node:path';

import type { FirebatReport } from '../../../../src/types';

import { scanUseCase } from '../../../../src/application/scan/scan.usecase';
import { createPrettyConsoleLogger } from '../../../../src/infrastructure/logging/pretty-console-logger';
import { createTempProject, installFakeBin, writeText } from '../../shared/external-tool-test-kit';

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await writeText(filePath, JSON.stringify(value, null, 2));
};

const withCwd = async <T>(cwdAbs: string, fn: () => Promise<T>): Promise<T> => {
  const prev = process.cwd();

  process.chdir(cwdAbs);

  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
};

interface ScanProjectFixture {
  readonly rootAbs: string;
  readonly srcFileAbs: string;
  dispose: () => Promise<void>;
}

interface ScanProjectFixtureMulti {
  readonly rootAbs: string;
  readonly targetsAbs: ReadonlyArray<string>;
  dispose: () => Promise<void>;
}

const createScanProjectFixture = async (prefix: string, sourceText: string): Promise<ScanProjectFixture> => {
  const project = await createTempProject(prefix);
  const srcFileAbs = path.join(project.rootAbs, 'src', 'a.ts');

  await writeJson(path.join(project.rootAbs, 'package.json'), {
    name: `${prefix}-fixture`,
    private: true,
    devDependencies: { firebat: '0.0.0' },
  });

  await writeJson(path.join(project.rootAbs, 'tsconfig.json'), {
    compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext' },
    include: ['src/**/*.ts'],
  });

  await writeText(srcFileAbs, sourceText);

  return {
    rootAbs: project.rootAbs,
    srcFileAbs,
    dispose: project.dispose,
  };
};

const createScanProjectFixtureWithFiles = async (
  prefix: string,
  files: Readonly<Record<string, string>>,
): Promise<ScanProjectFixtureMulti> => {
  const project = await createTempProject(prefix);

  await writeJson(path.join(project.rootAbs, 'package.json'), {
    name: `${prefix}-fixture`,
    private: true,
    devDependencies: { firebat: '0.0.0' },
  });

  await writeJson(path.join(project.rootAbs, 'tsconfig.json'), {
    compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext' },
    include: ['src/**/*.ts'],
  });

  const targetsAbs: string[] = [];

  for (const [relPath, content] of Object.entries(files)) {
    const abs = path.join(project.rootAbs, relPath);

    await writeText(abs, content);
    targetsAbs.push(abs);
  }

  return {
    rootAbs: project.rootAbs,
    targetsAbs,
    dispose: project.dispose,
  };
};

const createLogger = () => {
  return createPrettyConsoleLogger({ level: 'error', includeStack: false });
};

describe('integration/scan/report-contract', () => {
  it('should always include catalog field in the report', async () => {
    // Arrange
    const project = await createScanProjectFixture('firebat-report-contract-shape', 'export const a = 1;');

    try {
      const logger = createLogger();
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [project.srcFileAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['waste'],
            fix: false,
            help: false,
          },
          { logger },
        ),
      );

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
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [project.srcFileAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['format', 'waste'],
            fix: false,
            help: false,
          },
          { logger },
        ),
      );

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
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [project.srcFileAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['lint'],
            fix: false,
            help: false,
          },
          { logger },
        ),
      );

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
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [project.srcFileAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['dependencies', 'coupling'],
            fix: false,
            help: false,
          },
          { logger },
        ),
      );

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
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['dependencies', 'coupling'],
            fix: false,
            help: false,
          },
          { logger },
        ),
      );

      // Assert
      expect(Array.isArray(report.analyses.coupling)).toBe(true);
      expect((report.analyses.coupling ?? []).length).toBeGreaterThan(0);

      const item = (report.analyses.coupling as unknown as any[])[0];

      expect(typeof item.kind).toBe('string');
      expect(typeof item.code).toBe('string');
      expect(typeof item.file).toBe('string');
      expect(typeof item.span).toBe('object');

      expect(item.filePath).toBeUndefined();
      expect(item.why).toBeUndefined();
      expect(item.suggestedRefactor).toBeUndefined();
    } finally {
      await project.dispose();
    }
  });

  it('should emit api-drift groups using P0 field names (standard/params/optionals, file)', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('firebat-report-contract-api-drift-shape', {
      'src/a.ts': 'export function calibrateUser(id: string) { return id; }\n',
      'src/b.ts': 'export function calibrateUser(id: string, flag?: boolean) { return id; }\n',
      // NOTE: prefix family grouping requires >= 3 occurrences (see api-drift analyzer).
      'src/c.ts': 'export function calibrateOrder(id: string) { return id; }\n',
    });

    try {
      const logger = createLogger();
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['api-drift'],
            fix: false,
            help: false,
          },
          { logger },
        ),
      );

      // Assert
      expect(Array.isArray(report.analyses['api-drift'])).toBe(true);
      expect((report.analyses['api-drift'] ?? []).length).toBeGreaterThan(0);

      const group = (report.analyses['api-drift'] as unknown as any[])[0];

      expect(typeof group.label).toBe('string');
      expect(group.standardCandidate).toBeUndefined();
      expect(typeof group.standard).toBe('object');
      expect(typeof group.outliers).toBe('object');
      expect(Array.isArray(group.outliers)).toBe(true);
      expect(group.outliers.length).toBeGreaterThan(0);

      const outlier = group.outliers[0];

      expect(outlier.filePath).toBeUndefined();
      expect(typeof outlier.file).toBe('string');
      expect(typeof outlier.span).toBe('object');
      expect(typeof outlier.kind).toBe('string');
      expect(typeof outlier.code).toBe('string');
      expect(typeof outlier.shape).toBe('object');
      expect(outlier.shape.paramsCount).toBeUndefined();
      expect(outlier.shape.optionalCount).toBeUndefined();
      expect(typeof outlier.shape.params).toBe('number');
      expect(typeof outlier.shape.optionals).toBe('number');
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
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['dependencies'],
            fix: false,
            help: false,
          },
          { logger },
        ),
      );
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

  it('should emit exact-duplicates groups using P0 field names (kind/file/params) instead of cloneType/filePath/suggestedParams', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('firebat-report-contract-exact-dups-shape', {
      'src/a.ts': 'export const x = () => {\n  const a = 1;\n  return a + 1;\n};\n',
      'src/b.ts': 'export const y = () => {\n  const a = 1;\n  return a + 1;\n};\n',
    });

    try {
      const logger = createLogger();
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['exact-duplicates'],
            fix: false,
            help: false,
          },
          { logger },
        ),
      );

      // Assert
      expect(Array.isArray(report.analyses['exact-duplicates'])).toBe(true);

      const groups = report.analyses['exact-duplicates'] as unknown as any[];

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
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [project.srcFileAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['lint'],
            fix: false,
            help: false,
          },
          { logger },
        ),
      );

      // Assert
      expect(report.catalog).toBeDefined();
    } finally {
      await project.dispose();
    }
  });

  it('should enrich waste findings with file+code and expose them as a bare array', async () => {
    // Arrange
    const project = await createScanProjectFixture(
      'firebat-report-contract-waste-enrich',
      ['export function deadStore() {', '  let value = 1;', '  return 0;', '}'].join('\n'),
    );

    try {
      const logger = createLogger();
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [project.srcFileAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['waste'],
            fix: false,
            help: false,
          },
          { logger },
        ),
      );
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

  it('should expose noop findings as a bare array with file+code and no wrapper fields', async () => {
    // Arrange
    const project = await createScanProjectFixture('firebat-report-contract-noop-bare-array', '1;\nexport const a = 1;');

    try {
      const logger = createLogger();
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [project.srcFileAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['noop'],
            fix: false,
            help: false,
          },
          { logger },
        ),
      );
      // Assert
      const noop = report.analyses.noop as any;

      expect(Array.isArray(noop)).toBe(true);

      const findings = noop as any[];
      const expressionNoop = findings.find(f => f?.kind === 'expression-noop');

      expect(expressionNoop).toBeDefined();
      expect(typeof expressionNoop?.file).toBe('string');
      expect(expressionNoop?.file).toContain('src/a.ts');
      expect(expressionNoop?.filePath).toBeUndefined();
      expect(expressionNoop?.message).toBeUndefined();
      expect(expressionNoop?.why).toBeUndefined();
      expect(expressionNoop?.suggestedRefactor).toBeUndefined();
      expect(expressionNoop?.suggestions).toBeUndefined();
      expect(expressionNoop?.code).toBe('NOOP_EXPRESSION');
    } finally {
      await project.dispose();
    }
  });

  it('should expose barrel-policy findings as a bare array with file+code and no message field', async () => {
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
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['barrel-policy'],
            fix: false,
            help: false,
            barrelPolicyIgnoreGlobs: [],
          },
          { logger },
        ),
      );
      // Assert
      const barrel = report.analyses['barrel-policy'] as any;

      expect(Array.isArray(barrel)).toBe(true);

      const findings = barrel as any[];
      const exportStar = findings.find(f => f?.kind === 'export-star');

      expect(exportStar).toBeDefined();
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
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [project.srcFileAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['format', 'waste'],
            fix: false,
            help: false,
          },
          { logger },
        ),
      );

      // Assert
      expect(report.catalog).toBeDefined();
    } finally {
      await project.dispose();
    }
  });

  it('should expose exception-hygiene findings as a bare array with file+code and no wrapper fields', async () => {
    // Arrange
    const project = await createScanProjectFixture(
      'firebat-report-contract-exception-hygiene-bare-array',
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
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [project.srcFileAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['exception-hygiene'],
            fix: false,
            help: false,
          },
          { logger },
        ),
      );
      // Assert
      const findings = report.analyses['exception-hygiene'] as any;

      expect(Array.isArray(findings)).toBe(true);

      const throwNonError = (findings as any[]).find(f => f?.kind === 'throw-non-error');

      expect(throwNonError).toBeDefined();
      expect(typeof throwNonError?.file).toBe('string');
      expect(throwNonError?.file).toContain('src/a.ts');
      expect(throwNonError?.filePath).toBeUndefined();
      expect(throwNonError?.status).toBeUndefined();
      expect(throwNonError?.tool).toBeUndefined();
      expect(throwNonError?.message).toBeUndefined();
      expect(throwNonError?.recipes).toBeUndefined();
      expect(throwNonError?.code).toBe('EH_THROW_NON_ERROR');
    } finally {
      await project.dispose();
    }
  });

  it('should expose unknown-proof findings as a bare array with file+code and no wrapper fields', async () => {
    // Arrange
    const project = await createScanProjectFixture(
      'firebat-report-contract-unknown-proof-bare-array',
      ['export function doubleAssertion() {', '  const value = 1 as unknown as number;', '  return value;', '}'].join('\n'),
    );

    try {
      const logger = createLogger();
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [project.srcFileAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['unknown-proof'],
            fix: false,
            help: false,
          },
          { logger },
        ),
      );
      // Assert
      const findings = report.analyses['unknown-proof'] as any;

      expect(Array.isArray(findings)).toBe(true);

      const double = (findings as any[]).find(f => f?.kind === 'double-assertion');

      expect(double).toBeDefined();
      expect(typeof double?.file).toBe('string');
      expect(double?.file).toContain('src/a.ts');
      expect(double?.filePath).toBeUndefined();
      expect(double?.status).toBeUndefined();
      expect(double?.tool).toBeUndefined();
      expect(double?.message).toBeUndefined();
      expect(double?.code).toBe('UNKNOWN_DOUBLE_ASSERTION');
    } finally {
      await project.dispose();
    }
  });

  it('should expose forwarding findings as a bare array with file+code and no wrapper fields', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('firebat-report-contract-forwarding-bare-array', {
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
            format: 'json',
            minSize: 0,
            maxForwardDepth: 5,
            exitOnFindings: false,
            detectors: ['forwarding'],
            fix: false,
            help: false,
          },
          { logger },
        ),
      );
      // Assert
      const findings = report.analyses.forwarding as any;

      expect(Array.isArray(findings)).toBe(true);
      expect((findings as any[]).length).toBeGreaterThan(0);

      const first = (findings as any[])[0];

      expect(typeof first?.file).toBe('string');
      expect(first?.file).toContain('src/');
      expect(first?.filePath).toBeUndefined();
      expect(first?.status).toBeUndefined();
      expect(first?.tool).toBeUndefined();
      expect(typeof first?.code).toBe('string');
      expect(String(first?.code)).toContain('FWD_');
    } finally {
      await project.dispose();
    }
  });

  it('should expose structural-duplicates as a bare array of groups with kind/file and no legacy wrapper fields', async () => {
    // Arrange
    const project = await createScanProjectFixture(
      'firebat-report-contract-structural-duplicates-bare-array',
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
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [project.srcFileAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['structural-duplicates'],
            fix: false,
            help: false,
          },
          { logger },
        ),
      );
      // Assert
      const groups = report.analyses['structural-duplicates'] as any;

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
      'src/a.ts': ['export function deadStore() {', '  let value = 1;', '  return 0;', '}'].join('\n'),
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
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['waste', 'barrel-policy', 'exception-hygiene', 'lint', 'format', 'typecheck'],
            fix: false,
            help: false,
            barrelPolicyIgnoreGlobs: [],
          },
          { logger },
        ),
      );

      // Assert
      expect(typeof report.catalog.WASTE_DEAD_STORE?.cause).toBe('string');
      expect(typeof report.catalog.BARREL_EXPORT_STAR?.think[0]).toBe('string');
      expect(typeof report.catalog.EH_THROW_NON_ERROR?.cause).toBe('string');

      // catalog should not include unrelated codes
      expect(report.catalog.NOOP_EXPRESSION).toBeUndefined();
    } finally {
      await project.dispose();
    }
  });

  it('should have catalog entries with cause string and non-empty think array when findings are detected', async () => {
    // Arrange
    const project = await createScanProjectFixture(
      'firebat-report-contract-catalog-shape',
      ['export function deadStore() {', '  let value = 1;', '  return 0;', '}'].join('\n'),
    );

    try {
      const logger = createLogger();
      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [project.srcFileAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['waste'],
            fix: false,
            help: false,
          },
          { logger },
        ),
      );

      // Assert
      const entries = Object.values(report.catalog);

      expect(entries.length).toBeGreaterThan(0);

      for (const entry of entries) {
        expect(typeof entry.cause).toBe('string');
        expect(entry.cause.length).toBeGreaterThan(0);
        expect(Array.isArray(entry.think)).toBe(true);
        expect(entry.think.length).toBeGreaterThan(0);
        expect(typeof entry.think[0]).toBe('string');
      }
    } finally {
      await project.dispose();
    }
  });
});
