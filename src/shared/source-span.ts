import type { SourceSpan } from '../types';

/** Sentinel span for findings without a real source location (e.g. whole-module/file findings). */
export const ZERO_SPAN: SourceSpan = { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } };
