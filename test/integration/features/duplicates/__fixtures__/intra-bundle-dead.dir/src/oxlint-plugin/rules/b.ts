// Two plugin-bundle sources sharing a contract — intra-bundle clone is still W.
export interface NodeSpan {
  start: number;
  end: number;
  line: number;
  column: number;
}
