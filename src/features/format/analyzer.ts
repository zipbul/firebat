import type { FirebatLogger } from '../../ports/logger';

import { runOxfmt } from '../../tooling/oxfmt/oxfmt-runner';
import { createNoopLogger } from '../../ports/logger';

const createEmptyFormat = (): ReadonlyArray<string> => [];

interface AnalyzeFormatInput {
  readonly targets: ReadonlyArray<string>;
  readonly fix: boolean;
  readonly configPath?: string;
  readonly cwd?: string;
  readonly resolveMode?: 'default' | 'project-only';
  readonly logger?: FirebatLogger;
}

const parseOxfmtFiles = (rawStdout: unknown): ReadonlyArray<string> => {
  if (typeof rawStdout !== 'string') {
    return [];
  }

  const text = rawStdout.trim();

  if (text.length === 0) {
    return [];
  }

  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  const looksLikePath = (value: string): boolean => {
    if (value.includes('/') || value.includes('\\')) {
      return true;
    }

    return /\.(ts|tsx|js|jsx|json|md|css|scss|html)$/i.test(value);
  };

  const files = lines.filter(looksLikePath);

  return files;
};

export const __testing__ = {
  parseOxfmtFiles,
};

export const analyzeFormat = async (input: AnalyzeFormatInput): Promise<ReadonlyArray<string>> => {
  const logger = input.logger ?? createNoopLogger();
  const result = await runOxfmt({
    targets: input.targets,
    mode: input.fix ? 'write' : 'check',
    ...(input.configPath !== undefined ? { configPath: input.configPath } : {}),
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
    ...(input.resolveMode !== undefined ? { resolveMode: input.resolveMode } : {}),
    logger,
  });

  if (!result.ok) {
    const error = result.error ?? 'oxfmt failed';

    throw new Error(error);
  }

  if (!input.fix) {
    const exitCode = typeof result.exitCode === 'number' ? result.exitCode : 0;
    const files = parseOxfmtFiles(result.rawStdout);

    return exitCode === 0 ? [] : files;
  }

  return [];
};

export { createEmptyFormat };
