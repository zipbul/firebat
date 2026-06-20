/**
 * 값이 null이 아닌지 판정하고 타입을 NonNullable로 좁히는 단일 결정.
 * `.filter((x): x is NonNullable<typeof x> => x !== null)`처럼 여러 곳에 복제되던
 * null 제거 + narrowing 술어의 단일 변경지점이며, filter 술어로 그대로 쓴다.
 */
export const isNonNull = <T>(value: T): value is NonNullable<T> => value !== null;
