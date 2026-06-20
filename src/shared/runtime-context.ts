import { resolveFirebatRootFromCwd, type ResolveFirebatRootResult } from './root-resolver';

// 런타임 컨텍스트는 현재 루트 해석 결과(rootAbs + reason)와 같은 계약이다.
// 계약의 단일 변경지점을 위해 별도 선언 대신 재사용한다.
type FirebatRuntimeContext = ResolveFirebatRootResult;

export const resolveRuntimeContextFromCwd = async (startDirAbs: string = process.cwd()): Promise<FirebatRuntimeContext> => {
  const resolved = await resolveFirebatRootFromCwd(startDirAbs);

  return { rootAbs: resolved.rootAbs, reason: resolved.reason };
};
