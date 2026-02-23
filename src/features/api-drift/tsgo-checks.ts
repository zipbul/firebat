import type { ParsedFile } from '../../engine/types';
import type { FirebatLogger } from '../../shared/logger';
import type { ApiDriftGroup, ApiDriftShape, SourceSpan } from '../../types';

import { openTsDocument, withTsgoLspSession } from '../../tooling/tsgo/tsgo-runner';
import { createNoopLogger } from '../../shared/logger';

export interface ApiDriftInterfaceToken {
  readonly name: string;
  readonly span: SourceSpan;
}

export interface ApiDriftInterfaceMethodCandidate {
  readonly interfaceToken: ApiDriftInterfaceToken;
  readonly methodName: string;
  readonly shape: ApiDriftShape;
  readonly filePath: string;
  readonly span: SourceSpan;
}

interface RunTsgoApiDriftChecksInput {
  readonly program: ReadonlyArray<ParsedFile>;
  readonly candidatesByFile: ReadonlyMap<string, ReadonlyArray<ApiDriftInterfaceMethodCandidate>>;
  readonly rootAbs: string;
  readonly tsconfigPath?: string;
  readonly logger?: FirebatLogger;
}

interface RunTsgoApiDriftChecksOk {
  readonly ok: true;
  readonly groups: ReadonlyArray<ApiDriftGroup>;
}

interface RunTsgoApiDriftChecksFail {
  readonly ok: false;
  readonly error: string;
}

type RunTsgoApiDriftChecksResult = RunTsgoApiDriftChecksOk | RunTsgoApiDriftChecksFail;

const stringifyHover = (hover: unknown): string => {
  if (!hover || typeof hover !== 'object') {
    return '';
  }

  const contents = (hover as { contents?: unknown }).contents;

  if (typeof contents === 'string') {
    return contents;
  }

  if (Array.isArray(contents)) {
    return contents
      .map(entry => {
        if (typeof entry === 'string') {
          return entry;
        }

        if (entry && typeof entry === 'object') {
          const value = (entry as { value?: unknown }).value;

          return typeof value === 'string' ? value : '';
        }

        return '';
      })
      .filter(text => text.trim().length > 0)
      .join('\n');
  }

  if (contents && typeof contents === 'object') {
    const value = (contents as { value?: unknown }).value;

    if (typeof value === 'string') {
      return value;
    }
  }

  return '';
};

const looksLikeInterfaceHover = (hoverText: string): boolean => {
  const text = hoverText.toLowerCase();

  return text.includes('interface ') || text.includes('interface\n') || text.includes('interface\r\n');
};

interface GroupAccumulator {
  readonly label: string;
  readonly counts: Map<string, number>;
  readonly shapes: Map<string, ApiDriftShape>;
  readonly locations: Map<string, { filePath: string; span: SourceSpan }>;
}

const recordIntoGroup = (
  groupsByKey: Map<string, GroupAccumulator>,
  groupKey: string,
  label: string,
  shape: ApiDriftShape,
  location: { filePath: string; span: SourceSpan },
): void => {
  const entry = groupsByKey.get(groupKey) ?? {
    label,
    counts: new Map<string, number>(),
    shapes: new Map<string, ApiDriftShape>(),
    locations: new Map<string, { filePath: string; span: SourceSpan }>(),
  };
  const shapeKey = JSON.stringify(shape);

  entry.counts.set(shapeKey, (entry.counts.get(shapeKey) ?? 0) + 1);
  entry.shapes.set(shapeKey, shape);
  entry.locations.set(shapeKey, location);

  groupsByKey.set(groupKey, entry);
};

const buildGroups = (groupsByKey: Map<string, GroupAccumulator>): ApiDriftGroup[] => {
  const out: ApiDriftGroup[] = [];
  const keys = Array.from(groupsByKey.keys()).sort((left, right) => left.localeCompare(right));

  for (const key of keys) {
    const entry = groupsByKey.get(key);

    if (!entry || entry.counts.size <= 1) {
      continue;
    }

    let standardKey = '';
    let standardCount = -1;

    for (const [shapeKey, count] of entry.counts.entries()) {
      if (count > standardCount) {
        standardKey = shapeKey;
        standardCount = count;
      }
    }

    const standardShape = entry.shapes.get(standardKey);

    if (!standardShape) {
      continue;
    }

    const outliers = Array.from(entry.shapes.entries())
      .filter(([shapeKey]) => shapeKey !== standardKey)
      .map(([shapeKey, shape]) => {
        const loc = entry.locations.get(shapeKey);

        return {
          shape,
          filePath: loc?.filePath ?? '',
          span: loc?.span ?? { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } },
        };
      });

    if (outliers.length === 0) {
      continue;
    }

    out.push({ label: entry.label, standardCandidate: standardShape, outliers });
  }

  return out;
};

export const runTsgoApiDriftChecks = async (input: RunTsgoApiDriftChecksInput): Promise<RunTsgoApiDriftChecksResult> => {
  if (input.candidatesByFile.size === 0) {
    return { ok: true, groups: [] };
  }

  const fileByPath = new Map<string, ParsedFile>();

  for (const file of input.program) {
    fileByPath.set(file.filePath, file);
  }

  const result = await withTsgoLspSession<ReadonlyArray<ApiDriftGroup>>(
    {
      root: input.rootAbs,
      ...(input.tsconfigPath !== undefined ? { tsconfigPath: input.tsconfigPath } : {}),
      logger: input.logger ?? createNoopLogger(),
    },
    async session => {
      const groupsByKey = new Map<string, GroupAccumulator>();
      const confirmedInterfaces = new Set<string>();

      const requestHoverOnce = async (args: { uri: string; line: number; character: number }) => {
        return session.lsp
          .request('textDocument/hover', {
            textDocument: { uri: args.uri },
            position: { line: args.line, character: args.character },
          })
          .catch(() => null);
      };

      const requestHover = async (args: { uri: string; line: number; character: number }) => {
        const first = await requestHoverOnce(args);

        if (first !== null) {
          return first;
        }

        await new Promise<void>(r => setTimeout(r, 30));

        return requestHoverOnce(args);
      };

      for (const [filePath, candidates] of input.candidatesByFile.entries()) {
        const file = fileByPath.get(filePath);

        if (!file) {
          continue;
        }

        const { uri } = await openTsDocument({ lsp: session.lsp, filePath, text: file.sourceText });
        const seenToken = new Set<string>();

        for (const candidate of candidates) {
          const tokenKey = `${candidate.interfaceToken.name}:${candidate.interfaceToken.span.start.line}:${candidate.interfaceToken.span.start.column}`;

          if (seenToken.has(tokenKey)) {
            continue;
          }

          seenToken.add(tokenKey);

          const line0 = Math.max(0, candidate.interfaceToken.span.start.line - 1);
          const character0 = Math.max(0, candidate.interfaceToken.span.start.column);
          const hover = await requestHover({ uri, line: line0, character: character0 });
          const hoverText = stringifyHover(hover);

          if (!looksLikeInterfaceHover(hoverText)) {
            continue;
          }

          confirmedInterfaces.add(candidate.interfaceToken.name);
        }
      }

      if (confirmedInterfaces.size === 0) {
        return [];
      }

      for (const candidates of input.candidatesByFile.values()) {
        for (const method of candidates) {
          if (!confirmedInterfaces.has(method.interfaceToken.name)) {
            continue;
          }

          recordIntoGroup(
            groupsByKey,
            `iface:${method.interfaceToken.name}.${method.methodName}`,
            `${method.interfaceToken.name}.${method.methodName}`,
            method.shape,
            { filePath: method.filePath, span: method.span },
          );
        }
      }

      return buildGroups(groupsByKey);
    },
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, groups: result.value };
};
