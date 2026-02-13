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
  readonly resolveMode?: 'default' | 'project-only';
  readonly logger?: FirebatLogger;
}

const parseOxfmtFileCount = (rawStdout: unknown): number | undefined => {
  if (typeof rawStdout !== 'string') {
    return undefined;
  }

  const text = rawStdout.trim();

  if (text.length === 0) {
    return undefined;
  }

  const numericMatch = /(\d+)\s+files?/i.exec(text);

  if (numericMatch) {
    const parsed = Number(numericMatch[1]);

    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }

  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (lines.length === 0) {
    return undefined;
  }

  const looksLikePath = (value: string): boolean => {
    if (value.includes('/') || value.includes('\\')) {
      return true;
    }

    return /\.(ts|json|md|css|scss|html)$/i.test(value);
  };

  const pathLines = lines.filter(looksLikePath);

  return pathLines.length > 0 ? pathLines.length : undefined;
};

export const analyzeFormat = async (input: AnalyzeFormatInput): Promise<FormatAnalysis> => {
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
    const fileCount = parseOxfmtFileCount(result.rawStdout);

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

export { createEmptyFormat };
