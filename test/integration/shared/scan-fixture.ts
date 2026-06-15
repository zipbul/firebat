import { expect } from 'bun:test';
import * as path from 'node:path';

import { createPrettyConsoleLogger, scanUseCase } from '../../../src/test-api';
import { createTempProject, writeText } from './external-tool-test-kit';

export const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await writeText(filePath, JSON.stringify(value, null, 2));
};

export const withCwd = async <T>(cwdAbs: string, fn: () => Promise<T>): Promise<T> => {
  const prev = process.cwd();

  process.chdir(cwdAbs);

  try {
    return await fn();
  } finally {
    process.chdir(prev);
  }
};

export interface ScanProjectFixtureMulti {
  readonly rootAbs: string;
  readonly targetsAbs: ReadonlyArray<string>;
  dispose: () => Promise<void>;
}

export const createScanProjectFixtureWithFiles = async (
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

export const createScanLogger = () => {
  return createPrettyConsoleLogger({ level: 'error', includeStack: false });
};

/**
 * Assert the shared BaseFinding shape of a scan finding.
 *
 * `expectedKind` may be a single kind string, an array of allowed kinds, or
 * omitted to skip the kind check. Collapses the `expectBaseFinding` helper that
 * every scan-based feature spec otherwise re-declares verbatim.
 */
export const expectBaseFinding = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  item: any,
  expectedKind?: string | ReadonlyArray<string>,
): void => {
  expect(item).toBeDefined();

  if (typeof expectedKind === 'string') {
    expect(item.kind).toBe(expectedKind);
  } else if (Array.isArray(expectedKind)) {
    expect(expectedKind).toContain(item.kind);
  }

  expect(typeof item.file).toBe('string');
  expect(item.file.endsWith('.ts')).toBe(true);
  expect(item.span).toBeDefined();
};

/**
 * End-to-end scan harness shared by single-detector integration specs.
 *
 * Writes `files` into a fresh temp project, runs {@link scanUseCase} for the one
 * `detector` under that project's cwd, disposes the fixture, and returns the
 * detector's findings list (`[]` when absent). This collapses the
 * create-fixture → withCwd(scanUseCase) → read-analyses → dispose lifecycle that
 * every such spec otherwise restates verbatim; callers keep only their distinct
 * fixture and assertions.
 */
export const scanDetectorFindings = async (
  prefix: string,
  detector: string,
  files: Readonly<Record<string, string>>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> => {
  const project = await createScanProjectFixtureWithFiles(prefix, files);

  try {
    const report = await withCwd(project.rootAbs, () =>
      scanUseCase(
        {
          targets: [...project.targetsAbs],
          minSize: 0,
          maxForwardDepth: 0,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          detectors: [detector as any],
          help: false,
        },
        { logger: createScanLogger() },
      ),
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ((report as any)?.analyses?.[detector] as any[] | undefined) ?? [];
  } finally {
    await project.dispose();
  }
};
