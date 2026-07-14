import { normalizePath } from '@zipbul/gildash';

/** 정규식 메타문자를 이스케이프한다. */
const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 최소 glob → RegExp 변환. 경로 매칭의 단일 변경지점.
 * - `**` 는 `/` 포함 임의 문자열
 * - `**` 뒤에 곧바로 `/` 가 붙는 형태(선행이든 중간이든)는 표준 globstar
 *   의미론대로 0개 이상의 경로 세그먼트에 매칭한다(각 세그먼트는 `/` 로
 *   끝남 — 즉 통째로 생략 가능한 그룹). 뒤에 `/` 가 없는 `**`(예: `test/**`
 *   의 trailing `**`)는 기존대로 임의 문자열 그대로 유지한다 (F5:
 *   `**` + `/` + `*.spec.*` 가 루트의 `app.spec.ts` 도 매칭해야 하며,
 *   Bun.Glob 도 동일 의미론을 따른다).
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
        const afterStars = normalized[i + 2];

        if (afterStars === '/') {
          // "**/" — zero or more path segments, each followed by "/".
          out += '(?:.*/)?';
          i += 3;

          continue;
        }

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
