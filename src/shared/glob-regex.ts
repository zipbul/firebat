import { normalizePath } from '@zipbul/gildash';

/** 정규식 메타문자를 이스케이프한다. */
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 최소 glob → RegExp 변환. 경로 매칭의 단일 변경지점.
 * - `**` 는 `/` 포함 임의 문자열
 * - `*`  는 `/` 제외 임의 문자열
 * - `?`  는 `/` 제외 한 글자
 * 그 외 문자는 이스케이프해 그대로 매칭하며, 전체를 `^…$` 로 앵커한다.
 */
export const globToRegExp = (pattern: string): RegExp => {
  const normalized = normalizePath(pattern);
  let out = '^';
  let i = 0;

  while (i < normalized.length) {
    const ch = normalized[i] ?? '';

    if (ch === '*') {
      const next = normalized[i + 1];

      if (next === '*') {
        out += '.*';
        i += 2;

        continue;
      }

      out += '[^/]*';
      i += 1;

      continue;
    }

    if (ch === '?') {
      out += '[^/]';
      i += 1;

      continue;
    }

    out += escapeRegex(ch);
    i += 1;
  }

  out += '$';

  return new RegExp(out);
};
