// 4-member contract (size >= floor) duplicated across modules — real single-change-point break → W.
export interface RuleSpan {
  start: number;
  end: number;
  line: number;
  column: number;
}
