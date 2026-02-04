import * as path from 'node:path';

import { initHasher } from '../../engine/hasher';
import { parseSource } from '../../engine/parse-source';
import { extractSymbolsOxc } from '../../engine/symbol-extractor-oxc';
import type { SymbolMatch, SymbolIndexStats } from '../../ports/symbol-index.repository';
import { getOrmDb } from '../../infrastructure/sqlite/firebat.db';
import { createSqliteFileIndexRepository } from '../../infrastructure/sqlite/file-index.repository';
import { createSqliteSymbolIndexRepository } from '../../infrastructure/sqlite/symbol-index.repository';
import { createInMemoryFileIndexRepository } from '../../infrastructure/memory/file-index.repository';
import { createInMemorySymbolIndexRepository } from '../../infrastructure/memory/symbol-index.repository';
import { createHybridFileIndexRepository } from '../../infrastructure/hybrid/file-index.repository';
import { createHybridSymbolIndexRepository } from '../../infrastructure/hybrid/symbol-index.repository';
import { computeProjectKey } from '../scan/cache-keys';
import { indexTargets } from '../indexing/file-indexer';
import { discoverDefaultTargets } from '../../target-discovery';
import { resolveRuntimeContextFromCwd } from '../../runtime-context';
import { computeToolVersion } from '../../tool-version';

const resolveRoot = (root: string | undefined): string => {
  const cwd = process.cwd();

  if (root === undefined || root.trim().length === 0) {
    return path.resolve(cwd);
  }

  const trimmed = root.trim();

  return path.isAbsolute(trimmed) ? trimmed : path.resolve(cwd, trimmed);
};

const toAbsoluteTargets = async (rootAbs: string, targets: ReadonlyArray<string> | undefined): Promise<string[]> => {
  if (!targets || targets.length === 0) {
    return discoverDefaultTargets(rootAbs);
  }

  return targets.map(t => (path.isAbsolute(t) ? t : path.resolve(rootAbs, t)));
};

interface RepositoryContext {
  readonly rootAbs: string;
}

const getRepositories = async (ctx: RepositoryContext) => {
  const orm = await getOrmDb({ rootAbs: ctx.rootAbs });
  const fileIndexRepository = createHybridFileIndexRepository({
    memory: createInMemoryFileIndexRepository(),
    sqlite: createSqliteFileIndexRepository(orm),
  });
  const symbolIndexRepository = createHybridSymbolIndexRepository({
    memory: createInMemorySymbolIndexRepository(),
    sqlite: createSqliteSymbolIndexRepository(orm),
  });

  return { fileIndexRepository, symbolIndexRepository };
};

export interface IndexSymbolsInput {
  readonly root?: string;
  readonly targets?: ReadonlyArray<string>;
}

export interface IndexSymbolsResult {
  readonly ok: boolean;
  readonly indexedFiles: number;
  readonly skippedFiles: number;
  readonly symbolsIndexed: number;
  readonly parseErrors: number;
}

export interface SearchSymbolFromIndexInput {
  readonly root?: string;
  readonly query: string;
  readonly limit?: number;
}

export interface RootOnlyInput {
  readonly root?: string;
}

export const indexSymbolsUseCase = async (input: IndexSymbolsInput): Promise<IndexSymbolsResult> => {
  await initHasher();

  const ctx = await resolveRuntimeContextFromCwd();
  const rootAbs = resolveRoot(input.root);
  const toolVersion = computeToolVersion();
  const projectKey = computeProjectKey({ toolVersion, cwd: rootAbs });
  const { fileIndexRepository, symbolIndexRepository } = await getRepositories({ rootAbs: ctx.rootAbs });
  const targets = await toAbsoluteTargets(rootAbs, input.targets);

  await indexTargets({ projectKey, targets, repository: fileIndexRepository, concurrency: 8 });

  let indexedFiles = 0;
  let skippedFiles = 0;
  let symbolsIndexed = 0;
  let parseErrors = 0;

  for (const filePath of targets) {
    const fileRec = await fileIndexRepository.getFile({ projectKey, filePath });

    if (!fileRec) {
      continue;
    }

    const existing = await symbolIndexRepository.getIndexedFile({ projectKey, filePath });

    if (existing && existing.contentHash === fileRec.contentHash) {
      skippedFiles += 1;

      continue;
    }

    try {
      const sourceText = await Bun.file(filePath).text();
      const parsed = parseSource(filePath, sourceText);

      if (parsed.errors.length > 0) {
        parseErrors += parsed.errors.length;
      }

      const extracted = extractSymbolsOxc(parsed);
      const indexedAt = Date.now();

      await symbolIndexRepository.replaceFileSymbols({
        projectKey,
        filePath,
        contentHash: fileRec.contentHash,
        indexedAt,
        symbols: extracted.map(s => ({ kind: s.kind, name: s.name, span: s.span })),
      });

      indexedFiles += 1;
      symbolsIndexed += extracted.length;
    } catch {
      // Best-effort: keep previous index for that file.
      continue;
    }
  }

  return {
    ok: true,
    indexedFiles,
    skippedFiles,
    symbolsIndexed,
    parseErrors,
  };
};

export const searchSymbolFromIndexUseCase = async (input: SearchSymbolFromIndexInput): Promise<ReadonlyArray<SymbolMatch>> => {
  const ctx = await resolveRuntimeContextFromCwd();
  const rootAbs = resolveRoot(input.root);
  const toolVersion = computeToolVersion();
  const projectKey = computeProjectKey({ toolVersion, cwd: rootAbs });
  const { symbolIndexRepository } = await getRepositories({ rootAbs: ctx.rootAbs });

  return symbolIndexRepository.search({ projectKey, query: input.query, ...(input.limit !== undefined ? { limit: input.limit } : {}) });
};

export const getIndexStatsFromIndexUseCase = async (input: RootOnlyInput): Promise<SymbolIndexStats> => {
  const ctx = await resolveRuntimeContextFromCwd();
  const rootAbs = resolveRoot(input.root);
  const toolVersion = computeToolVersion();
  const projectKey = computeProjectKey({ toolVersion, cwd: rootAbs });
  const { symbolIndexRepository } = await getRepositories({ rootAbs: ctx.rootAbs });

  return symbolIndexRepository.getStats({ projectKey });
};

export const clearIndexUseCase = async (input: RootOnlyInput): Promise<void> => {
  const ctx = await resolveRuntimeContextFromCwd();
  const rootAbs = resolveRoot(input.root);
  const toolVersion = computeToolVersion();
  const projectKey = computeProjectKey({ toolVersion, cwd: rootAbs });
  const { symbolIndexRepository } = await getRepositories({ rootAbs: ctx.rootAbs });

  await symbolIndexRepository.clearProject({ projectKey });
};
