/**
 * 문자열을 separator로 쪼개 각 조각을 trim 하고 빈 조각을 버린다.
 * "분리 → 공백 제거 → 빈 항목 제외"라는 텍스트 토큰화 결정의 단일 변경지점.
 */
export const splitTrimNonEmpty = (text: string, separator: string): string[] =>
  text
    .split(separator)
    .map(part => part.trim())
    .filter(part => part.length > 0);
