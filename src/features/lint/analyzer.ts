import type { ToolAnalysisInput } from '../../shared/tool-analysis-input';
import type { LintDiagnostic } from '../../types';

import { createNoopLogger } from '../../shared/logger';
import { runOxlint } from '../../tooling/oxlint/oxlint-runner';
import { throwIfToolRunFailed } from '../../tooling/tool-failure';

const createEmptyLint = (): ReadonlyArray<LintDiagnostic> => [];

const normalizeSeverity = (severity: 'error' | 'warning' | 'info'): 'error' | null => {
  if (severity === 'info') {
    return null;
  }

  return 'error';
};

type AnalyzeLintInput = ToolAnalysisInput;

export const analyzeLint = async (input: AnalyzeLintInput): Promise<ReadonlyArray<LintDiagnostic>> => {
  const logger = input.logger ?? createNoopLogger();
  const result = await runOxlint({
    targets: input.targets,
    ...(input.configPath !== undefined ? { configPath: input.configPath } : {}),
    ...(input.fix ? { fix: true } : {}),
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
    ...(input.resolveMode !== undefined ? { resolveMode: input.resolveMode } : {}),
    logger,
  });
  const normalizedDiagnostics: ReadonlyArray<LintDiagnostic> = (result.diagnostics ?? [])
    .map(d => {
      const nextSeverity = normalizeSeverity(d.severity);

      if (nextSeverity === null || d.filePath === undefined) {
        return null;
      }

      return Object.assign({ file: d.filePath, msg: d.message }, typeof d.code === `string` ? { code: d.code } : {}, {
        severity: nextSeverity,
        span: d.span,
      }) satisfies LintDiagnostic;
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);

  throwIfToolRunFailed(result, 'oxlint failed');

  if (input.fix) {
    return [];
  }

  return normalizedDiagnostics;
};

export { createEmptyLint };
