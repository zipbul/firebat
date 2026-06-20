const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isStringArray = (value: unknown): value is string[] => {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
};

/**
 * 객체(배열 포함)면 string-key 레코드로 보고, 아니면 null.
 * 동적 키 접근 전 "객체인가" 가드의 단일 변경지점.
 */
const asRecordOrNull = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return value as Record<string, unknown>;
};

export { asRecordOrNull, isPlainObject, isStringArray };
