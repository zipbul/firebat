import * as path from 'node:path';

/**
 * Project-root 기준 상대 경로로 정규화한다 (POSIX 슬래시).
 * rootAbs 밖이거나 동일 경로라 상대 경로가 비면 원본을 슬래시 정규화해 반환한다.
 */
export const toProjectRelative = (rootAbs: string, filePath: string): string => {
  const rel = path.relative(rootAbs, filePath);
  const normalized = rel.replaceAll('\\', '/');

  return normalized.length > 0 ? normalized : filePath.replaceAll('\\', '/');
};
