interface OffsetRange {
  readonly start: number;
  readonly end: number;
}

/**
 * offset가 주어진 범위들 중 하나에라도 `[start, end)` 로 포함되는지 판정한다.
 * 소스 오프셋의 "범위 멤버십" 결정의 단일 변경지점.
 */
export const isOffsetInAnyRange = (offset: number, ranges: ReadonlyArray<OffsetRange>): boolean =>
  ranges.some(r => offset >= r.start && offset < r.end);
