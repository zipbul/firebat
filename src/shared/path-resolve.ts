import { normalizePath } from '@zipbul/gildash';
import * as path from 'node:path';

/**
 * gildash가 돌려준 경로(프로젝트-상대일 수 있음)를 절대 경로로 정규화한다.
 * 이미 절대면 그대로 정규화, 상대면 rootAbs 기준으로 resolve 후 정규화한다.
 */
export const resolveAbs = (rootAbs: string, p: string): string =>
  normalizePath(path.isAbsolute(p) ? p : path.resolve(rootAbs, p));
