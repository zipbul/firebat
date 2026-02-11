import type { FirebatLogger } from '../../ports/logger';
import type { LintAnalysis } from '../../types';

import { runOxlint } from '../../infrastructure/oxlint/oxlint-runner';
import { createNoopLogger } from '../../ports/logger';

const createEmptyLint = (): LintAnalysis => ({
  status: 'ok',
  tool: 'oxlint',
  diagnostics: [],
});

interface AnalyzeLintInput {
  readonly targets: ReadonlyArray<string>;
  readonly fix: boolean;
  readonly configPath?: string;
  readonly cwd?: string;
  readonly logger?: FirebatLogger;
}

export const analyzeLint = async (input: AnalyzeLintInput): Promise<LintAnalysis> => {
  const logger = input.logger ?? createNoopLogger();
  const result = await runOxlint({
    targets: input.targets,
    ...(input.configPath !== undefined ? { configPath: input.configPath } : {}),
    ...(input.fix ? { fix: true } : {}),
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
    logger,
  });

  if (!result.ok) {
    const error = result.error ?? 'oxlint failed';
    const status = error.includes('not available') ? 'unavailable' : 'failed';

    return {
      status,
      tool: 'oxlint',
      ...(typeof result.exitCode === 'number' ? { exitCode: result.exitCode } : {}),
      error,
      diagnostics: result.diagnostics ?? [],
    };
  }

  return {
    status: 'ok',
    tool: 'oxlint',
    ...(typeof result.exitCode === 'number' ? { exitCode: result.exitCode } : {}),
    diagnostics: result.diagnostics ?? [],
  };
};

export { analyzeLint, createEmptyLint };
