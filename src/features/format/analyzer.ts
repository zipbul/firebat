import type { ToolAnalysisInput } from '../../shared/tool-analysis-input';

import { createNoopLogger } from '../../shared/logger';
import { splitTrimNonEmpty } from '../../shared/split-lines';
import { runOxfmt } from '../../tooling/oxfmt/oxfmt-runner';
import { throwIfToolRunFailed } from '../../tooling/tool-failure';

const createEmptyFormat = (): ReadonlyArray<string> => [];

type AnalyzeFormatInput = ToolAnalysisInput;

const parseOxfmtFiles = (rawStdout: unknown): ReadonlyArray<string> => {
  if (typeof rawStdout !== 'string') {
    return [];
  }

  const text = rawStdout.trim();

  if (text.length === 0) {
    return [];
  }

  const lines = splitTrimNonEmpty(text, '\n');

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

  throwIfToolRunFailed(result, 'oxfmt failed');

  if (!input.fix) {
    const exitCode = typeof result.exitCode === 'number' ? result.exitCode : 0;
    const files = parseOxfmtFiles(result.rawStdout);

    return exitCode === 0 ? [] : files;
  }

  return [];
};

export { createEmptyFormat };
