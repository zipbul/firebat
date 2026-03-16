import type { Gildash } from '@zipbul/gildash';

import type { ParsedFile } from '../../engine/types';
import type { UnknownProofFinding } from '../../types';

import { PartialResultError } from '../../engine/partial-result-error';
import { collectBindingCandidates, collectExpressionCandidates } from './candidates';
import { runSemanticUnknownProofChecks } from './semantic-checks';

interface AnalyzeUnknownProofInput {
  readonly rootAbs?: string;
  readonly gildash?: Gildash;
}

export const createEmptyUnknownProof = (): ReadonlyArray<UnknownProofFinding> => [];

export const analyzeUnknownProof = (
  program: ReadonlyArray<ParsedFile>,
  input?: AnalyzeUnknownProofInput,
): ReadonlyArray<UnknownProofFinding> => {
  const candidatesByFile = collectBindingCandidates({ program });
  const exprCandidatesByFile = collectExpressionCandidates({ program });
  // expression candidates -> findings (hover not needed, AST-only)
  const exprFindings: UnknownProofFinding[] = [];

  for (const [filePath, candidates] of exprCandidatesByFile) {
    for (const c of candidates) {
      exprFindings.push({
        kind: c.kind,
        message: c.kind === 'double-cast'
          ? 'Double assertion bypasses type safety (as unknown as T)'
          : 'Explicit `as any` cast removes type safety',
        filePath,
        span: c.span,
        evidence: c.sourceSnippet,
      });
    }
  }

  if (candidatesByFile.size === 0) {
    return exprFindings;
  }

  if (!input?.gildash) {
    throw new PartialResultError('gildash not available for unknown-proof semantic checks', exprFindings);
  }

  try {
    const result = runSemanticUnknownProofChecks({
      program,
      candidatesByFile,
      gildash: input.gildash,
    });

    if (result.ok) {
      return [...result.findings, ...exprFindings];
    }

    throw new PartialResultError(result.error, [...result.findings, ...exprFindings]);
  } catch (e) {
    if (e instanceof PartialResultError) {
      throw e;
    }

    const message = e instanceof Error ? e.message : String(e);

    throw new PartialResultError(message, exprFindings);
  }
};
