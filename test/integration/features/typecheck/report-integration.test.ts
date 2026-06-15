import { afterAll, afterEach, beforeAll, describe, expect, it, mock } from 'bun:test';
import * as path from 'node:path';

import type { TypecheckItem } from '../../../../src/test-api';

import { createScanLogger, createScanProjectFixtureWithFiles, withCwd } from '../../shared/scan-fixture';

const createTypecheckOk = (items: ReadonlyArray<TypecheckItem>): ReadonlyArray<TypecheckItem> => {
  return items;
};

const typecheckEntryAbs = path.resolve(import.meta.dir, '../../../../src/features/typecheck/index.ts');
const analyzeTypecheckMock = mock(async (): Promise<ReadonlyArray<TypecheckItem>> => createTypecheckOk([]));
const __origTypecheckEntry = { ...require(typecheckEntryAbs) };

void mock.module(typecheckEntryAbs, () => {
  return {
    analyzeTypecheck: analyzeTypecheckMock,
    createEmptyTypecheck: () => createTypecheckOk([]),
  };
});

let scanUseCase: typeof import('../../../../src/application/scan/scan.usecase').scanUseCase;

beforeAll(async () => {
  ({ scanUseCase } = await import('../../../../src/application/scan/scan.usecase'));
});

afterEach(() => {
  analyzeTypecheckMock.mockReset();
  analyzeTypecheckMock.mockImplementation(async () => createTypecheckOk([]));
  mock.clearAllMocks();
});

describe('integration/typecheck/report-integration', () => {
  it('should capture typecheck failures into meta.errors and not throw when typecheck execution fails', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('firebat-typecheck-error-aggregation', {
      'src/a.ts': 'export const a = 1;',
    });

    try {
      const logger = createScanLogger();

      analyzeTypecheckMock.mockImplementationOnce(async () => {
        throw new Error('typecheck failed');
      });

      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            minSize: 0,
            maxForwardDepth: 0,
            detectors: ['typecheck'],
            help: false,
          },
          { logger },
        ),
      );

      // Assert
      expect(report.meta.errors).toBeDefined();
      expect(report.meta.errors?.typecheck ?? '').toContain('typecheck');
      expect(report.analyses.typecheck).toBeUndefined();
    } finally {
      await project.dispose();
    }
  });

  it('should exclude typecheck from top even when typecheck returns many items', async () => {
    // Arrange
    const project = await createScanProjectFixtureWithFiles('firebat-typecheck-top-exclusion', {
      'src/a.ts': 'export const a = 1;',
    });

    try {
      const logger = createScanLogger();

      analyzeTypecheckMock.mockImplementationOnce(async () =>
        createTypecheckOk([
          {
            severity: 'error',
            code: 'TS2322',
            msg: 'Type error A',
            file: 'src/a.ts',
            span: {
              start: { line: 1, column: 1 },
              end: { line: 1, column: 2 },
            },
            codeFrame: 'export const a = 1;\n^',
          },
          {
            severity: 'error',
            code: 'TS2322',
            msg: 'Type error B',
            file: 'src/a.ts',
            span: {
              start: { line: 1, column: 1 },
              end: { line: 1, column: 2 },
            },
            codeFrame: 'export const a = 1;\n^',
          },
        ]),
      );

      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [...project.targetsAbs],
            minSize: 0,
            maxForwardDepth: 0,
            detectors: ['typecheck'],
            help: false,
          },
          { logger },
        ),
      );

      // Assert
      expect(report.analyses.typecheck).toBeDefined();
      expect(Array.isArray(report.analyses.typecheck)).toBe(true);
      expect((report.analyses.typecheck as any[])[0]?.filePath).toBeUndefined();
      expect((report.analyses.typecheck as any[])[0]?.message).toBeUndefined();
      expect((report.analyses.typecheck as any[])[0]?.lineText).toBeUndefined();
    } finally {
      await project.dispose();
    }
  });
});

afterAll(() => {
  mock.restore();
  void mock.module(typecheckEntryAbs, () => __origTypecheckEntry);
});
