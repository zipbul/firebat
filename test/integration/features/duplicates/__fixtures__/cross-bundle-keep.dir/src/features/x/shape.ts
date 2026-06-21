// CLI-bundle file outside the plugin area — same contract shape by coincidence.
export interface SpanInfo {
  start: number;
  end: number;
  line: number;
  column: number;
}
