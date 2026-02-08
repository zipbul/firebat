import { resolveFirebatRootFromCwd } from './root-resolver';

export interface FirebatRuntimeContext {
  readonly rootAbs: string;
  readonly reason: 'declared-dependency' | 'self-repo';
}

export const resolveRuntimeContextFromCwd = async (startDirAbs: string = process.cwd()): Promise<FirebatRuntimeContext> => {
  const resolved = await resolveFirebatRootFromCwd(startDirAbs);

  return { rootAbs: resolved.rootAbs, reason: resolved.reason };
};
