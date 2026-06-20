/**
 * 후보 값이 비어 있지 않은 문자열일 때에 한해 집합에 추가하는 단일 결정.
 * "문자열인가 + 비어있지 않은가" 검사와 등록의 변경지점이다.
 */
export const addNonEmptyString = (set: Set<string>, value: unknown): void => {
  if (typeof value === 'string' && value.length > 0) {
    set.add(value);
  }
};
