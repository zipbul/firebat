import * as path from 'node:path';

import { resolveFirebatRootFromCwd, type ResolveFirebatRootResult } from './root-resolver';

// 런타임 컨텍스트는 현재 루트 해석 결과(rootAbs + reason)와 같은 계약이다.
// 계약의 단일 변경지점을 위해 별도 선언 대신 재사용한다.
type FirebatRuntimeContext = ResolveFirebatRootResult;

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

export const resolveRuntimeContextFromCwd = async (startDirAbs: string = process.cwd()): Promise<FirebatRuntimeContext> => {
  const resolved = await resolveFirebatRootFromCwd(startDirAbs);

  return { rootAbs: resolved.rootAbs, reason: resolved.reason };
};
