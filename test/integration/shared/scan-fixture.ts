import * as path from 'node:path';

import { createPrettyConsoleLogger } from '../../../src/test-api';
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
