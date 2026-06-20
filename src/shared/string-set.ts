/**
 * 값이 비어 있지 않은 문자열인지 판정하는 단일 결정.
 * "문자열인가 + 비어있지 않은가" 검사의 변경지점이며, narrowing 가드로도 쓴다.
 */
export const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/**
 * 후보 값이 비어 있지 않은 문자열일 때에 한해 집합에 추가하는 단일 결정.
 */
export const addNonEmptyString = (set: Set<string>, value: unknown): void => {
  if (isNonEmptyString(value)) {
    set.add(value);
  }
};
