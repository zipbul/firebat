import type { ParsedFile } from '../../engine/types';
import type { InvariantBlindspotFinding } from '../../types';

import { normalizeFile } from '../../engine/normalize-file';
import { getLineColumn } from '../../engine/source-position';

const createEmptyInvariantBlindspot = (): ReadonlyArray<InvariantBlindspotFinding> => [];

const spanForOffset = (sourceText: string, offset: number) => {
  const start = getLineColumn(sourceText, Math.max(0, offset));
  const end = getLineColumn(sourceText, Math.min(sourceText.length, Math.max(0, offset + 1)));

  return { start, end };
};

const analyzeInvariantBlindspot = (files: ReadonlyArray<ParsedFile>): ReadonlyArray<InvariantBlindspotFinding> => {
  if (files.length === 0) {
    return createEmptyInvariantBlindspot();
  }

  const findings: InvariantBlindspotFinding[] = [];
  const signals: ReadonlyArray<{ readonly name: string; readonly re: RegExp }> = [
    { name: 'console.assert', re: /console\.assert\s*\(/g },
    { name: 'throw-guard', re: /\bthrow\s+new\s+Error\s*\(/g },
    { name: 'must-comment', re: /\/\/.*\b(must|always|never)\b/gi },
    { name: 'switch-default-throw', re: /\bdefault\s*:\s*\bthrow\b/gi },
    { name: 'bounds-throw', re: /\bif\s*\([^)]*\.length\s*===\s*0\)\s*throw\b/gi },
  ];

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const rel = normalizeFile(file.filePath);

    if (!rel.endsWith('.ts')) {
      continue;
    }

    let hitOffset: number | null = null;

    for (const s of signals) {
      s.re.lastIndex = 0;

      const m = s.re.exec(file.sourceText);

      if (m !== null) {
        hitOffset = m.index;

        break;
      }
    }

    if (hitOffset === null) {
      continue;
    }

    const evidence = file.sourceText.slice(hitOffset, Math.min(file.sourceText.length, hitOffset + 200));

    findings.push({
      kind: 'invariant-blindspot',
      file: rel,
      span: spanForOffset(file.sourceText, hitOffset),
      signal: evidence,
    });
  }

  return findings;
};

export { analyzeInvariantBlindspot, createEmptyInvariantBlindspot };
