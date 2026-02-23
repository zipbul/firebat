import { ts } from '@ast-grep/napi';

import type { FirebatLogger } from '../../ports/logger';
import type { SourceSpan } from '../../types';

interface AstGrepMatch {
  readonly filePath: string;
  readonly span: SourceSpan;
  readonly text: string;
  readonly ruleId: string;
}

interface AstGrepPosition {
  readonly line: number;
  readonly column: number;
}

interface AstGrepRange {
  readonly start: AstGrepPosition;
  readonly end: AstGrepPosition;
}

interface AstGrepNode {
  text: () => string;
  range: () => AstGrepRange;
}

interface AstGrepRoot {
  findAll?: (matcher: unknown) => ReadonlyArray<AstGrepNode>;
  find?: (matcher: unknown) => AstGrepNode | null;
}

interface MatcherInput {
  rule?: unknown;
  matcher?: unknown;
  ruleName?: string;
}

interface MatcherResult {
  ruleId: string;
  matcher: unknown;
}

interface FindPatternInput extends MatcherInput {
  targets: ReadonlyArray<string>;
  logger: FirebatLogger;
}

const toSpan = (range: AstGrepRange): SourceSpan => {
  return {
    start: { line: range.start.line + 1, column: range.start.column + 1 },
    end: { line: range.end.line + 1, column: range.end.column + 1 },
  };
};

const resolveMatcher = (input: MatcherInput): MatcherResult => {
  if (input.matcher !== undefined) {
    return { ruleId: input.ruleName ?? 'inline', matcher: input.matcher };
  }

  if (input.rule !== undefined) {
    return { ruleId: input.ruleName ?? 'inline', matcher: { rule: input.rule } };
  }

  throw new Error('Either matcher or rule must be provided.');
};

const findPatternInFiles = async (input: FindPatternInput): Promise<ReadonlyArray<AstGrepMatch>> => {
  const { ruleId, matcher } = resolveMatcher(input);
  const results: AstGrepMatch[] = [];

  input.logger.debug('ast-grep: searching pattern', { ruleId, fileCount: input.targets.length });

  for (const filePath of input.targets) {
    const code = await Bun.file(filePath).text();
    const sg = ts.parse(code);
    const root = sg.root() as AstGrepRoot;
    const allMatches = typeof root.findAll === 'function' ? root.findAll(matcher) : [];
    const firstMatch = typeof root.find === 'function' ? root.find(matcher) : null;
    const nodes = allMatches.length > 0 ? allMatches : firstMatch ? [firstMatch] : [];

    for (const node of nodes) {
      const range = node.range();

      results.push({
        filePath,
        span: toSpan(range),
        text: node.text(),
        ruleId,
      });
    }

    if (nodes.length > 0) {
      input.logger.trace('ast-grep: matches in file', { filePath, matchCount: nodes.length });
    }
  }

  input.logger.debug('ast-grep: search complete', { totalMatches: results.length });

  return results;
};

export { findPatternInFiles };
export type { AstGrepMatch };
