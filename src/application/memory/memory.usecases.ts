import * as path from 'node:path';

import type { FirebatLogger } from '../../ports/logger';
import type { MemoryRepository } from '../../ports/memory.repository';

import { getOrmDb } from '../../infrastructure/sqlite/firebat.db';
import { createSqliteMemoryRepository } from '../../infrastructure/sqlite/memory.repository';

interface JsonObject {
  readonly [k: string]: JsonValue;
}

type JsonValue = null | boolean | number | string | ReadonlyArray<JsonValue> | JsonObject;

interface RootInput {
  readonly root?: string;
  readonly logger: FirebatLogger;
}

interface ReadMemoryInput {
  readonly root?: string;
  readonly memoryKey: string;
  readonly logger: FirebatLogger;
}

interface ReadMemoryOutput {
  readonly memoryKey: string;
  readonly value: JsonValue;
}

interface WriteMemoryInput {
  readonly root?: string;
  readonly memoryKey: string;
  readonly value: JsonValue;
  readonly logger: FirebatLogger;
}

interface DeleteMemoryInput {
  readonly root?: string;
  readonly memoryKey: string;
  readonly logger: FirebatLogger;
}

const resolveProjectKey = (root: string | undefined): string => {
  const cwd = process.cwd();

  if (root === undefined || root.trim().length === 0) {
    return path.resolve(cwd);
  }

  const trimmed = root.trim();

  return path.isAbsolute(trimmed) ? trimmed : path.resolve(cwd, trimmed);
};

const repoPromisesByProjectKey = new Map<string, Promise<MemoryRepository>>();

interface RepositoryInput {
  readonly root?: string;
  readonly logger: FirebatLogger;
}

const getRepository = async (input: RepositoryInput) => {
  const projectKey = resolveProjectKey(input.root);
  const existing = repoPromisesByProjectKey.get(projectKey);

  if (existing) {
    return { projectKey, repo: await existing };
  }

  const created = (async (): Promise<MemoryRepository> => {
    const orm = await getOrmDb({ rootAbs: projectKey, logger: input.logger });

    return createSqliteMemoryRepository(orm);
  })();

  repoPromisesByProjectKey.set(projectKey, created);

  return { projectKey, repo: await created };
};

const listMemoriesUseCase = async (input: RootInput) => {
  input.logger.debug('memory:list');

  const repoInput = input.root === undefined ? { logger: input.logger } : { root: input.root, logger: input.logger };
  const { projectKey, repo } = await getRepository(repoInput);

  return repo.listKeys({ projectKey });
};

const readMemoryUseCase = async (input: ReadMemoryInput): Promise<ReadMemoryOutput | null> => {
  input.logger.debug('memory:read', { memoryKey: input.memoryKey });

  const repoInput = input.root === undefined ? { logger: input.logger } : { root: input.root, logger: input.logger };
  const { projectKey, repo } = await getRepository(repoInput);
  const rec = await repo.read({ projectKey, memoryKey: input.memoryKey });

  if (!rec) {
    return null;
  }

  try {
    return { memoryKey: input.memoryKey, value: JSON.parse(rec.payloadJson) as JsonValue };
  } catch {
    return { memoryKey: input.memoryKey, value: rec.payloadJson };
  }
};

const writeMemoryUseCase = async (input: WriteMemoryInput): Promise<void> => {
  input.logger.debug('memory:write', { memoryKey: input.memoryKey });

  const repoInput = input.root === undefined ? { logger: input.logger } : { root: input.root, logger: input.logger };
  const { projectKey, repo } = await getRepository(repoInput);
  const payloadJson = JSON.stringify(input.value);

  await repo.write({ projectKey, memoryKey: input.memoryKey, payloadJson });
};

const deleteMemoryUseCase = async (input: DeleteMemoryInput): Promise<void> => {
  input.logger.debug('memory:delete', { memoryKey: input.memoryKey });

  const repoInput = input.root === undefined ? { logger: input.logger } : { root: input.root, logger: input.logger };
  const { projectKey, repo } = await getRepository(repoInput);

  await repo.delete({ projectKey, memoryKey: input.memoryKey });
};

export { listMemoriesUseCase, readMemoryUseCase, writeMemoryUseCase, deleteMemoryUseCase };
