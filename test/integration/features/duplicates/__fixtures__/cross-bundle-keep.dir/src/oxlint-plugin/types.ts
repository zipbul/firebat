// Plugin bundle source (reachable from oxlint-plugin.ts) — private vocabulary.
export interface SourceSpan {
  start: number;
  end: number;
  line: number;
  column: number;
}
