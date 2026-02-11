import type { FirebatLogger } from '../../ports/logger';
import type { FormatAnalysis } from '../../types';

import { runOxfmt } from '../../infrastructure/oxfmt/oxfmt-runner';
import { createNoopLogger } from '../../ports/logger';

const createEmptyFormat = (): FormatAnalysis => ({
  status: 'ok',
  tool: 'oxfmt',
});

interface AnalyzeFormatInput {
  readonly targets: ReadonlyArray<string>;
  readonly fix: boolean;
  readonly configPath?: string;
  readonly cwd?: string;
  readonly logger?: FirebatLogger;
}

export const analyzeFormat = async (input: AnalyzeFormatInput): Promise<FormatAnalysis> => {
  const logger = input.logger ?? createNoopLogger();
  const result = await runOxfmt({
    targets: input.targets,
    mode: input.fix ? 'write' : 'check',
    ...(input.configPath !== undefined ? { configPath: input.configPath } : {}),
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
    logger,
  });

  if (!result.ok) {
    const error = result.error ?? 'oxfmt failed';
    const status = error.includes('not available') ? 'unavailable' : 'failed';

    return {
      status,
      tool: 'oxfmt',
      error,
      ...(typeof result.exitCode === 'number' ? { exitCode: result.exitCode } : {}),
    };
  }

  if (!input.fix) {
    const exitCode = typeof result.exitCode === 'number' ? result.exitCode : 0;
    const fileCount =
      typeof result.rawStdout === 'string' ? result.rawStdout.split('\n').filter(l => l.trim().length > 0).length : undefined;

    return {
      status: exitCode === 0 ? 'ok' : 'needs-formatting',
      tool: 'oxfmt',
      ...(typeof result.exitCode === 'number' ? { exitCode: result.exitCode } : {}),
      ...(typeof fileCount === 'number' ? { fileCount } : {}),
    };
  }

  return {
    status: 'ok',
    tool: 'oxfmt',
    ...(typeof result.exitCode === 'number' ? { exitCode: result.exitCode } : {}),
  };
};

export { analyzeFormat, createEmptyFormat };
