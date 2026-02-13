import type { ParsedFile } from '../../engine/types';
import type { FirebatLogger } from '../../ports/logger';
import type { SourceSpan, UnknownProofFinding } from '../../types';

import { withTsgoLspSession, openTsDocument } from '../../infrastructure/tsgo/tsgo-runner';
import { createNoopLogger } from '../../ports/logger';
import { stringifyHover } from './candidates';

interface BindingCandidate {
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

interface UnknownOrAnyFlag {
  readonly unknown: boolean;
  readonly any: boolean;
  readonly typeSnippet: string;
}

interface BoundaryUnknownMessage {
  readonly message: string;
  readonly evidence: string;
}

interface HoverRequestArgs {
  readonly uri: string;
  readonly line: number;
  readonly character: number;
}

interface RunTsgoUnknownProofChecksInput {
  readonly program: ReadonlyArray<ParsedFile>;
  readonly rootAbs: string;
  readonly candidatesByFile: ReadonlyMap<string, ReadonlyArray<BindingCandidate>>;
  readonly boundaryUsageCandidatesByFile?: ReadonlyMap<string, ReadonlyArray<BoundaryUsageCandidate>>;
  readonly tsconfigPath?: string;
  readonly logger?: FirebatLogger;
}

interface RunTsgoUnknownProofChecksOk {
  readonly ok: true;
  readonly findings: ReadonlyArray<UnknownProofFinding>;
}

interface RunTsgoUnknownProofChecksFail {
  readonly ok: false;
  readonly error: string;
  readonly findings: ReadonlyArray<UnknownProofFinding>;
}

type RunTsgoUnknownProofChecksResult = RunTsgoUnknownProofChecksOk | RunTsgoUnknownProofChecksFail;

const createEmptySpan = (): SourceSpan => ({
  start: { line: 1, column: 1 },
  end: { line: 1, column: 1 },
});

const pickTypeSnippetFromHoverText = (text: string): string => {
  if (text.trim().length === 0) {
    return '';
  }

  const blocks: string[] = [];
  const regex = /```(?:typescript|ts)?\s*([\s\S]*?)```/gm;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const candidate = (match[1] ?? '').trim();

    if (candidate.length > 0) {
      blocks.push(candidate);
    }
  }

  const pick = (body: string): string => {
    const firstLine =
      body
        .split(/\r?\n/)
        .map(l => l.trim())
        .find(l => l.length > 0) ?? '';

    return firstLine.slice(0, 200);
  };

  if (blocks.length > 0) {
    const typeBlock = blocks.find(b => /^(const|let|var|type|interface|function|class)\b/.test(b));

    return pick(typeBlock ?? blocks[0] ?? '');
  }

  return pick(text.trim());
};

const hasWord = (text: string, word: string): boolean => new RegExp(`\\b${word}\\b`).test(text);

const hasWordInType = (typeSnippet: string, word: string): boolean => {
  const colonIndex = typeSnippet.indexOf(':');
  const typePart = colonIndex >= 0 ? typeSnippet.slice(colonIndex + 1) : typeSnippet;

  return hasWord(typePart, word);
};

const shouldFlagUnknownOrAny = (hoverText: string): UnknownOrAnyFlag => {
  const snippet = pickTypeSnippetFromHoverText(hoverText);
  const haystack = snippet.length > 0 ? snippet : hoverText;

  return {
    unknown: snippet.length > 0 ? hasWordInType(haystack, 'unknown') : hasWord(haystack, 'unknown'),
    any: snippet.length > 0 ? hasWordInType(haystack, 'any') : hasWord(haystack, 'any'),
    typeSnippet: snippet,
  };
};

export const __test__ = {
  pickTypeSnippetFromHoverText,
  shouldFlagUnknownOrAny,
};

const formatBoundaryUnknownMessage = (kind: BoundaryUsageKind): BoundaryUnknownMessage => {
  if (kind === 'call') {
    return { message: 'Boundary `unknown` is passed without narrowing', evidence: 'propagation=call' };
  }

  if (kind === 'assign') {
    return { message: 'Boundary `unknown` is assigned without narrowing', evidence: 'propagation=assign' };
  }

  if (kind === 'store') {
    return { message: 'Boundary `unknown` is stored without narrowing', evidence: 'propagation=store' };
  }

  if (kind === 'return') {
    return { message: 'Boundary `unknown` is returned without narrowing', evidence: 'propagation=return' };
  }

  return { message: 'Boundary `unknown` is thrown without narrowing', evidence: 'propagation=throw' };
};

export const runTsgoUnknownProofChecks = async (
  input: RunTsgoUnknownProofChecksInput,
): Promise<RunTsgoUnknownProofChecksResult> => {
  const rootAbs = input.rootAbs;
  const fileByPath = new Map<string, ParsedFile>();

  for (const file of input.program) {
    fileByPath.set(file.filePath, file);
  }

  const result = await withTsgoLspSession<ReadonlyArray<UnknownProofFinding>>(
    {
      root: rootAbs,
      ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}),
      logger: input.logger ?? createNoopLogger(),
    },
    async session => {
      const findings: UnknownProofFinding[] = [];

      const requestHoverOnce = async (args: HoverRequestArgs) => {
        return session.lsp
          .request('textDocument/hover', {
            textDocument: { uri: args.uri },
            position: { line: args.line, character: args.character },
          })
          .catch(() => null);
      };

      const requestHover = async (args: HoverRequestArgs) => {
        const first = await requestHoverOnce(args);

        if (first !== null) {
          return first;
        }

        // tsgo can occasionally need a brief warm-up right after didOpen.
        await new Promise<void>(r => setTimeout(r, 30));

        return requestHoverOnce(args);
      };

      const filePaths = new Set<string>();

      for (const filePath of input.candidatesByFile.keys()) {
        filePaths.add(filePath);
      }
      for (const filePath of input.boundaryUsageCandidatesByFile?.keys() ?? []) {
        filePaths.add(filePath);
      }

      for (const filePath of filePaths) {
        const file = fileByPath.get(filePath);

        if (!file) {
          continue;
        }

        const outsideCandidates = input.candidatesByFile.get(filePath) ?? [];
        const boundaryUsageCandidates = input.boundaryUsageCandidatesByFile?.get(filePath) ?? [];

        if (outsideCandidates.length === 0 && boundaryUsageCandidates.length === 0) {
          continue;
        }

        const { uri } = await openTsDocument({ lsp: session.lsp, filePath, text: file.sourceText });

        try {
          for (const candidate of outsideCandidates) {
            const line0 = Math.max(0, candidate.span.start.line - 1);
            const character0 = Math.max(0, candidate.span.start.column);
            const hover = await requestHover({ uri, line: line0, character: character0 });
            const hoverText = stringifyHover(hover);
            const flag = shouldFlagUnknownOrAny(hoverText);

            if (flag.unknown) {
              findings.push({
                kind: 'unknown-inferred',
                message: 'Type is (or contains) `unknown` outside boundary files',
                filePath,
                span: candidate.span,
                symbol: candidate.name,
                ...(flag.typeSnippet.length > 0 ? { typeText: flag.typeSnippet } : {}),
              });
            }

            if (flag.any) {
              findings.push({
                kind: 'any-inferred',
                message: 'Type is (or contains) `any` outside boundary files',
                filePath,
                span: candidate.span,
                symbol: candidate.name,
                ...(flag.typeSnippet.length > 0 ? { typeText: flag.typeSnippet } : {}),
              });
            }
          }

          for (const candidate of boundaryUsageCandidates) {
            const line0 = Math.max(0, candidate.span.start.line - 1);
            const character0 = Math.max(0, candidate.span.start.column);
            const hover = await requestHover({ uri, line: line0, character: character0 });
            const hoverText = stringifyHover(hover);
            const flag = shouldFlagUnknownOrAny(hoverText);

            if (flag.unknown) {
              const msg = formatBoundaryUnknownMessage(candidate.usageKind);

              findings.push({
                kind: 'unvalidated-unknown',
                message: msg.message,
                filePath,
                span: candidate.span,
                symbol: candidate.name,
                evidence: msg.evidence,
                ...(flag.typeSnippet.length > 0 ? { typeText: flag.typeSnippet } : {}),
              });
            }
          }
        } finally {
          await session.lsp.notify('textDocument/didClose', { textDocument: { uri } }).catch(() => undefined);
        }
      }

      return findings;
    },
  );

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      findings: [
        {
          kind: 'tool-unavailable',
          message: 'tsgo is unavailable; unknown-proof cannot be proven',
          filePath: rootAbs,
          span: createEmptySpan(),
          ...(result.error.length > 0 ? { evidence: result.error.slice(0, 300) } : {}),
        },
      ],
    };
  }

  return { ok: true, findings: result.value };
};
