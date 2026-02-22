import type { ParsedFile } from '../../engine/types';
import type { VariableLifetimeFinding } from '../../types';

import { collectOxcNodes, getNodeName } from '../../engine/oxc-ast-utils';
import { normalizeFile } from '../../engine/normalize-file';
import { getLineColumn } from '../../engine/source-position';

const createEmptyVariableLifetime = (): ReadonlyArray<VariableLifetimeFinding> => [];

const spanForOffsets = (sourceText: string, startOffset: number, endOffset: number) => {
  const start = getLineColumn(sourceText, Math.max(0, startOffset));
  const end = getLineColumn(sourceText, Math.max(0, endOffset));

  return { start, end };
};

interface AnalyzeVariableLifetimeOptions {
  readonly maxLifetimeLines: number;
}

const lineStarts = (sourceText: string): ReadonlyArray<number> => {
  const starts: number[] = [0];

  for (let i = 0; i < sourceText.length; i++) {
    const ch = sourceText.charCodeAt(i);

    if (ch === 10) {
      starts.push(i + 1);
    }
  }

  return starts;
};

const offsetToLineIndex = (starts: ReadonlyArray<number>, offset: number): number => {
  let lo = 0;
  let hi = starts.length - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const start = starts[mid] ?? 0;
    const next = starts[mid + 1] ?? Number.POSITIVE_INFINITY;

    if (offset >= start && offset < next) {
      return mid;
    }

    if (offset < start) {
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  return 0;
};

const analyzeVariableLifetime = (
  files: ReadonlyArray<ParsedFile>,
  options: AnalyzeVariableLifetimeOptions,
): ReadonlyArray<VariableLifetimeFinding> => {
  if (files.length === 0) {
    return createEmptyVariableLifetime();
  }

  const maxLifetimeLines = Math.max(0, Math.floor(options.maxLifetimeLines));
  const findings: VariableLifetimeFinding[] = [];

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const rel = normalizeFile(file.filePath);

    if (!rel.endsWith('.ts')) {
      continue;
    }

    const starts = lineStarts(file.sourceText);
    const declRe = /\b(const|let|var)\s+([a-zA-Z_$][\w$]*)\b/g;
    const longLived: Array<{ readonly name: string; readonly defOffset: number; readonly lifeLines: number }> = [];

    for (;;) {
      const m = declRe.exec(file.sourceText);

      if (m === null) {
        break;
      }

      const name = String(m[2] ?? '');
      const defOffset = m.index;
      // Find last AST identifier node with matching name at or after the declaration.
      let lastOffset = defOffset;

      for (const idNode of collectOxcNodes(file.program, n => n.type === 'Identifier' && getNodeName(n) === name && n.start >= defOffset)) {
        if (idNode.start > lastOffset) {
          lastOffset = idNode.start;
        }
      }

      const defLine = offsetToLineIndex(starts, defOffset);
      const lastLine = offsetToLineIndex(starts, lastOffset);
      const lifeLines = Math.max(0, lastLine - defLine);

      if (lifeLines > maxLifetimeLines) {
        longLived.push({ name, defOffset, lifeLines });
      }
    }

    const contextBurden = longLived.length;

    for (const item of longLived) {
      const evidenceEnd = Math.min(file.sourceText.length, item.defOffset + 200);

      findings.push({
        kind: 'variable-lifetime',
        file: rel,
        span: spanForOffsets(file.sourceText, item.defOffset, evidenceEnd),
        variable: item.name,
        lifetimeLines: item.lifeLines,
        contextBurden,
      });
    }
  }

  return findings;
};

export { analyzeVariableLifetime, createEmptyVariableLifetime };
