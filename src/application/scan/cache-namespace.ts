import { normalizePath } from '@zipbul/gildash';
import * as path from 'node:path';

import { hashString } from '../../engine/hasher';

const CACHE_SCHEMA_VERSION = 2;

const computeBuildId = async (): Promise<string> => {
  const scriptArg = Bun.argv[1];

  if (typeof scriptArg !== 'string' || scriptArg.length === 0) {
    return 'no-script-arg';
  }

  const scriptPath = path.isAbsolute(scriptArg) ? scriptArg : path.resolve(process.cwd(), scriptArg);

  try {
    const stats = await Bun.file(scriptPath).stat();

    return hashString(`script|${normalizePath(scriptPath)}|${String(stats.mtimeMs)}|${String(stats.size)}`);
  } catch {
    return hashString(`script|missing|${normalizePath(scriptPath)}`);
  }
};

interface CacheNamespaceInput {
  readonly toolVersion: string;
}

const computeCacheNamespace = async (input: CacheNamespaceInput): Promise<string> => {
  const buildId = await computeBuildId();

  return hashString(
    ['firebat', `schema=${String(CACHE_SCHEMA_VERSION)}`, `tool=${input.toolVersion}`, `build=${buildId}`].join('|'),
  );
};

export { CACHE_SCHEMA_VERSION, computeCacheNamespace };
