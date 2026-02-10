import type { ParsedFile } from '../../engine/types';
import type { FirebatLogger } from '../../ports/logger';
import type { SourceSpan, UnknownProofAnalysis, UnknownProofFinding } from '../../types';

import { collectUnknownProofCandidates } from './candidates';
import { runTsgoUnknownProofChecks } from './tsgo-checks';

interface AnalyzeUnknownProofInput {
  readonly rootAbs?: string;
  readonly boundaryGlobs?: ReadonlyArray<string>;
  readonly tsconfigPath?: string;
  readonly logger?: FirebatLogger;
}

interface TsgoUnknownProofCandidate {
  readonly name: string;
  readonly offset: number;
  readonly span: SourceSpan;
}

type BoundaryUsageKind = 'call' | 'assign' | 'store' | 'return' | 'throw';

interface BoundaryUsageCandidate {
  readonly name: string;
  readonly offset: number;
  readonly span: SourceSpan;
  readonly usageKind: BoundaryUsageKind;
}

export const createEmptyUnknownProof = (): UnknownProofAnalysis => ({
  status: 'ok',
  tool: 'tsgo',
  findings: [],
});

export const analyzeUnknownProof = async (
  program: ReadonlyArray<ParsedFile>,
  input?: AnalyzeUnknownProofInput,
): Promise<UnknownProofAnalysis> => {
  const rootAbs = input?.rootAbs ?? process.cwd();
  const boundaryGlobs = input?.boundaryGlobs;
  const collected = collectUnknownProofCandidates({
    program,
    rootAbs,
    ...(boundaryGlobs !== undefined ? { boundaryGlobs } : {}),
  });
  const findings: UnknownProofFinding[] = [];
  const tsgoCandidatesByFile = new Map<string, ReadonlyArray<TsgoUnknownProofCandidate>>();
  const boundaryUsageCandidatesByFile = new Map<string, ReadonlyArray<BoundaryUsageCandidate>>();

  for (const [filePath, perFile] of collected.perFile.entries()) {
    findings.push(...perFile.typeAssertionFindings);

    if (perFile.nonBoundaryBindings.length > 0) {
      tsgoCandidatesByFile.set(filePath, perFile.nonBoundaryBindings);
    }

    if (perFile.boundaryUnknownUsages.length > 0) {
      boundaryUsageCandidatesByFile.set(filePath, perFile.boundaryUnknownUsages);
    }
  }

  if (tsgoCandidatesByFile.size === 0 && boundaryUsageCandidatesByFile.size === 0) {
    return {
      status: 'ok',
      tool: 'tsgo',
      findings,
    };
  }

  // Proof phase: ensure no `unknown|any` exists outside boundary files.
  const tsgoResult = await runTsgoUnknownProofChecks({
    program,
    rootAbs,
    candidatesByFile: tsgoCandidatesByFile,
    boundaryUsageCandidatesByFile,
    ...(input?.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}),
    ...(input?.logger !== undefined ? { logger: input.logger } : {}),
  });

  if (!tsgoResult.ok) {
    findings.push(...tsgoResult.findings);

    return {
      status: 'unavailable',
      tool: 'tsgo',
      error: tsgoResult.error,
      findings,
    };
  }

  findings.push(...tsgoResult.findings);

  return {
    status: 'ok',
    tool: 'tsgo',
    findings,
  };
};
