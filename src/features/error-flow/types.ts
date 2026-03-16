import type { FirebatCatalogCode } from '../../types';

export type ErrorFlowFindingKind =
  | 'tool-unavailable'
  | 'throw-non-error'
  | 'promise-constructor-hygiene'
  | 'missing-error-cause'
  | 'useless-catch'
  | 'unsafe-finally'
  | 'catch-or-return'
  | 'prefer-catch'
  | 'prefer-await-to-then'
  | 'floating-promises'
  | 'misused-promises'
  | 'return-await-policy';

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
