import type { ParsedFile } from '../../engine/types';
import type { DecisionSurfaceFinding } from '../../types';

import { normalizeFile } from '../../engine/normalize-file';
import { getLineColumn } from '../../engine/source-position';

const createEmptyDecisionSurface = (): ReadonlyArray<DecisionSurfaceFinding> => [];

const spanForMatch = (sourceText: string, startOffset: number, endOffset: number) => {
  const start = getLineColumn(sourceText, Math.max(0, startOffset));
  const end = getLineColumn(sourceText, Math.max(0, endOffset));

  return { start, end };
};

interface AnalyzeDecisionSurfaceOptions {
  readonly maxAxes: number;
}

const extractIfConditions = (sourceText: string): ReadonlyArray<{ readonly text: string; readonly offset: number }> => {
  const conditions: Array<{ readonly text: string; readonly offset: number }> = [];
  const re = /\bif\s*\(([^)]*)\)/g;

  for (;;) {
    const match = re.exec(sourceText);

    if (match === null) {
      break;
    }

    const cond = String(match[1] ?? '').trim();

    conditions.push({ text: cond, offset: match.index });
  }

  return conditions;
};

const extractAxesFromCondition = (conditionText: string): ReadonlyArray<string> => {
  // Heuristic: capture identifiers / property access used in condition.
  // Examples: user.vip, order.amount > 1000, config.strict, user.role === "admin".
  const axes: string[] = [];
  const cleaned = conditionText
    .replace(/'[^'\\]*(?:\\.[^'\\]*)*'/g, '')
    .replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, '')
    .replace(/`[^`\\]*(?:\\.[^`\\]*)*`/g, '');
  const tokenRe = /\b([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)*)\b/g;
  const keywords = new Set(['if', 'return', 'true', 'false', 'null', 'undefined', 'new', 'typeof', 'instanceof']);

  for (;;) {
    const m = tokenRe.exec(cleaned);

    if (m === null) {
      break;
    }

    const token = String(m[1] ?? '');

    if (keywords.has(token)) {
      continue;
    }

    // Exclude obvious numeric-like or operator-like tokens
    if (/^\d+$/.test(token)) {
      continue;
    }

    axes.push(token);
  }

  return axes;
};

const analyzeDecisionSurface = (
  files: ReadonlyArray<ParsedFile>,
  options: AnalyzeDecisionSurfaceOptions,
): ReadonlyArray<DecisionSurfaceFinding> => {
  if (files.length === 0) {
    return createEmptyDecisionSurface();
  }

  const maxAxes = Math.max(0, Math.floor(options.maxAxes));
  const findings: DecisionSurfaceFinding[] = [];

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const rel = normalizeFile(file.filePath);

    if (!rel.endsWith('.ts')) {
      continue;
    }

    const conditions = extractIfConditions(file.sourceText);
    const axisCounts = new Map<string, number>();

    for (const c of conditions) {
      for (const axis of extractAxesFromCondition(c.text)) {
        axisCounts.set(axis, (axisCounts.get(axis) ?? 0) + 1);
      }
    }

    const axes = axisCounts.size;
    const repeatedChecks = [...axisCounts.values()].filter(n => n >= 2).length;
    const combinatorialPaths = Math.pow(2, axes);

    if (axes < maxAxes) {
      continue;
    }

    const firstOffset = conditions.length > 0 ? conditions[0].offset : 0;
    const evidence = file.sourceText.slice(firstOffset, Math.min(file.sourceText.length, firstOffset + 200));

    findings.push({
      kind: 'decision-surface',
      file: rel,
      span: spanForMatch(file.sourceText, firstOffset, Math.min(file.sourceText.length, firstOffset + evidence.length)),
      axes,
      combinatorialPaths,
      repeatedChecks,
    });
  }

  return findings;
};

export { analyzeDecisionSurface, createEmptyDecisionSurface };
