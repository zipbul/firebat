import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test';
import * as path from 'node:path';

import type { LintDiagnostic } from '../../../../src/types';

import { createScanLogger, createScanProjectFixtureWithFiles, runScanReport } from '../../shared/scan-fixture';

// analyzeLint's documented contract discards diagnostics entirely when fix=true
// (see src/features/lint/analyzer.spec.ts "[HP] returns [] when fix=true"), and
// scanUseCase always calls it with fix:true — so a fixture that shells out to a
// fake oxlint binary can never produce a non-empty analyses.lint through the real
// pipeline. Mocking the feature module (same technique as
// test/integration/features/typecheck/report-integration.test.ts) is the only way
// to prove the LINT catalog-entry contract against a lint finding that actually
// reaches the report.
const createLintOk = (items: ReadonlyArray<LintDiagnostic>): ReadonlyArray<LintDiagnostic> => {
  return items;
};

const lintEntryAbs = path.resolve(import.meta.dir, '../../../../src/features/lint/index.ts');
const analyzeLintMock = mock(async (): Promise<ReadonlyArray<LintDiagnostic>> => createLintOk([]));
const __origLintEntry = { ...require(lintEntryAbs) };

void mock.module(lintEntryAbs, () => {
  return {
    analyzeLint: analyzeLintMock,
    createEmptyLint: () => createLintOk([]),
  };
});

let scanUseCase: typeof import('../../../../src/application/scan/scan.usecase').scanUseCase;

beforeAll(async () => {
  ({ scanUseCase } = await import('../../../../src/application/scan/scan.usecase'));
});

afterEach(() => {
  analyzeLintMock.mockReset();
  analyzeLintMock.mockImplementation(async () => createLintOk([]));
  mock.clearAllMocks();
});

describe('integration/lint/report-integration', () => {
  it('should include catalog entry for LINT with cause and think when a lint finding reaches the report', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('firebat-lint-catalog-entry', {
      'src/a.ts': 'export const a = 1;',
    });

    try {
      const logger = createScanLogger();

      analyzeLintMock.mockImplementationOnce(async () =>
        createLintOk([
          {
            severity: 'error',
            code: 'no-unused-vars',
            msg: 'unused variable',
            file: 'src/a.ts',
            span: { start: { line: 1, column: 1 }, end: { line: 1, column: 2 } },
          },
        ]),
      );

      // Act
      const report = await runScanReport(project, ['lint'], logger, [...project.targetsAbs]);

      // Assert
      expect(Array.isArray(report.analyses.lint)).toBe(true);
      expect((report.analyses.lint as unknown[]).length).toBeGreaterThan(0);
      expect(typeof report.catalog.LINT?.cause).toBe('string');
      expect(Array.isArray(report.catalog.LINT?.think)).toBe(true);
      expect(report.catalog.LINT?.think.length ?? 0).toBeGreaterThan(0);
    } finally {
      await project.dispose();
    }
  });
});

afterAll(() => {
  mock.restore();
  void mock.module(lintEntryAbs, () => __origLintEntry);
});
