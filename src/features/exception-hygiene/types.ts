export type ExceptionHygieneFindingKind =
  | 'tool-unavailable'
  | 'throw-non-error'
  | 'async-promise-executor'
  | 'missing-error-cause'
  | 'useless-catch'
  | 'unsafe-finally'
  | 'return-in-finally'
  | 'catch-or-return'
  | 'prefer-catch'
  | 'prefer-await-to-then'
  | 'floating-promises'
  | 'misused-promises'
  | 'return-await-policy'
  | 'silent-catch'
  | 'catch-transform-hygiene'
  | 'redundant-nested-catch'
  | 'overscoped-try'
  | 'exception-control-flow';

export interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

export interface SourceSpan {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export interface ExceptionHygieneFinding {
  readonly kind: ExceptionHygieneFindingKind;
  readonly file: string;
  readonly span: SourceSpan;
  readonly code?: string;
  readonly evidence: string;
}
