import * as path from 'node:path';

import { resolveFirebatRootFromCwd, type ResolveFirebatRootResult } from './root-resolver';

/**
 * The directory root resolution starts from. Precedence: explicit `--cwd`/`-C`
 * argument → `FIREBAT_CWD` env → `process.cwd()`. Single change-point so every
 * resolver (entry + usecase) starts from the same place.
 */
export const resolveStartDir = (cwd?: string): string => {
  const fromEnv = process.env.FIREBAT_CWD;

  if (typeof cwd === 'string' && cwd.length > 0) {
    return path.resolve(cwd);
  }

  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    return path.resolve(fromEnv);
  }

  return process.cwd();
};

export const resolveRuntimeContextFromCwd = async (startDirAbs: string = process.cwd()): Promise<ResolveFirebatRootResult> => {
  const resolved = await resolveFirebatRootFromCwd(startDirAbs);

  return { rootAbs: resolved.rootAbs, reason: resolved.reason };
};
