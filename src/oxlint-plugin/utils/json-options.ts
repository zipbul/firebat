import type { JsonObject, JsonValue } from '../types';

import { isPlainObject } from '../../shared/json-guards';

// 런타임 판정은 src/shared/json-guards 한 곳에만 둔다. 여기선 플러그인 타입(JsonObject)으로
// 좁히는 얇은 위임 래퍼 — 파라미터 무변형 단일 호출이라 골격(K)으로 분류돼 중복 보고되지 않는다.
// (oxlint-plugin은 별도 entrypoint지만 Bun.build가 로컬 src import를 인라인하므로 번들 자립성 유지.)
const isJsonObject = (value: JsonValue | undefined): value is JsonObject => isPlainObject(value);

const toStringList = (value: JsonValue | undefined): string[] | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const out: string[] = [];

  for (const item of value) {
    if (typeof item === 'string') {
      out.push(item);
    }
  }

  return out.length > 0 ? out : null;
};

const toStringOrStringList = (value: JsonValue | undefined): string | string[] | null => {
  if (typeof value === 'string') {
    return value;
  }

  return toStringList(value);
};

export { isJsonObject, toStringList, toStringOrStringList };
