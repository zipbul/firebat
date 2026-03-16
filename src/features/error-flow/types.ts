import type { FirebatCatalogCode } from '../../types';

export type ErrorFlowFindingKind =
  | 'tool-unavailable'
  | 'throw-non-error'
  | 'promise-constructor-hygiene'
  | 'missing-error-cause'
  | 'useless-catch'
  | 'unsafe-finally'
  | 'return-await-in-try'
  | 'prefer-catch'
  | 'prefer-await-to-then'
  | 'no-return-wrap'
  | 'floating-promises'
  | 'catch-or-return'
  | 'misused-promises'
  | 'unobserved-variable'
  | 'always-return'
  | 'no-callback-in-promise';

export interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

export interface SourceSpan {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export interface ErrorFlowFinding {
  readonly kind: ErrorFlowFindingKind;
  readonly file: string;
  readonly span: SourceSpan;
  readonly code?: FirebatCatalogCode;
  readonly evidence: string;
}
