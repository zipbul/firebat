import { afterEach, beforeAll, describe, expect, it, mock } from 'bun:test';
import * as path from 'node:path';

import type { TypecheckItem } from '../../../src/types';

import { createPrettyConsoleLogger } from '../../../src/infrastructure/logging/pretty-console-logger';
import { createTempProject, writeText } from '../shared/external-tool-test-kit';

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

interface TypecheckProjectFixture {
  readonly rootAbs: string;
  readonly srcFileAbs: string;
  dispose: () => Promise<void>;
}

const createTypecheckProjectFixture = async (prefix: string, sourceText: string): Promise<TypecheckProjectFixture> => {
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

const createLogger = () => {
  return createPrettyConsoleLogger({ level: 'error', includeStack: false });
};

const createTypecheckOk = (items: ReadonlyArray<TypecheckItem>): ReadonlyArray<TypecheckItem> => {
  return items;
};

const typecheckEntryAbs = path.resolve(import.meta.dir, '../../../src/features/typecheck/index.ts');
const analyzeTypecheckMock = mock(async (): Promise<ReadonlyArray<TypecheckItem>> => createTypecheckOk([]));

mock.module(typecheckEntryAbs, () => {
  return {
    analyzeTypecheck: analyzeTypecheckMock,
    createEmptyTypecheck: () => createTypecheckOk([]),
  };
});

let scanUseCase: typeof import('../../../src/application/scan/scan.usecase').scanUseCase;

beforeAll(async () => {
  ({ scanUseCase } = await import('../../../src/application/scan/scan.usecase'));
});

afterEach(() => {
  analyzeTypecheckMock.mockReset();
  analyzeTypecheckMock.mockImplementation(async () => createTypecheckOk([]));
  mock.clearAllMocks();
});

describe('integration/typecheck/report-integration', () => {
  it('should capture typecheck failures into meta.errors and not throw when typecheck execution fails', async () => {
    // Arrange
    const project = await createTypecheckProjectFixture('firebat-typecheck-error-aggregation', 'export const a = 1;');

    try {
      const logger = createLogger();

      analyzeTypecheckMock.mockImplementationOnce(async () => {
        throw new Error('tsgo failed');
      });

      // Act
      const report = await withCwd(project.rootAbs, () =>
        scanUseCase(
          {
            targets: [project.srcFileAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['typecheck'],
            fix: false,
            help: false,
          },
          { logger },
        ),
      );

      // Assert
      expect(report.meta.errors).toBeDefined();
      expect(report.meta.errors?.typecheck ?? '').toContain('tsgo');
      expect(report.analyses.typecheck).toBeUndefined();
    } finally {
      await project.dispose();
    }
  });

  it('should exclude typecheck from top even when typecheck returns many items', async () => {
    // Arrange
    const project = await createTypecheckProjectFixture('firebat-typecheck-top-exclusion', 'export const a = 1;');

    try {
      const logger = createLogger();

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
            targets: [project.srcFileAbs],
            format: 'json',
            minSize: 0,
            maxForwardDepth: 0,
            exitOnFindings: false,
            detectors: ['typecheck'],
            fix: false,
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
      expect(Array.isArray(report.top)).toBe(true);
      expect(report.top.some(p => p.detector === 'typecheck')).toBe(false);
    } finally {
      await project.dispose();
    }
  });
});
