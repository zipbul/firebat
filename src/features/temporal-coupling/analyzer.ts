import type { ParsedFile } from '../../engine/types';
import type { TemporalCouplingFinding } from '../../types';

import { normalizeFile } from '../../engine/normalize-file';
import { getLineColumn } from '../../engine/source-position';

const createEmptyTemporalCoupling = (): ReadonlyArray<TemporalCouplingFinding> => [];

const spanForOffset = (sourceText: string, offset: number) => {
  const start = getLineColumn(sourceText, Math.max(0, offset));
  const end = getLineColumn(sourceText, Math.min(sourceText.length, Math.max(0, offset + 1)));

  return { start, end };
};

const analyzeTemporalCoupling = (files: ReadonlyArray<ParsedFile>): ReadonlyArray<TemporalCouplingFinding> => {
  if (files.length === 0) {
    return createEmptyTemporalCoupling();
  }

  const findings: TemporalCouplingFinding[] = [];

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const rel = normalizeFile(file.filePath);

    if (!rel.endsWith('.ts')) {
      continue;
    }

    // module-scope var/let
    const m = /^\s*(let|var)\s+([a-zA-Z_$][\w$]*)\b/m.exec(file.sourceText);

    if (m !== null) {
      const name = String(m[2] ?? '');
      const writerRe = new RegExp(
        `\\bexport\\s+function\\s+([a-zA-Z_$][\\w$]*)\\s*\\([^)]*\\)[^{]*\\{[\\s\\S]*?\\b${name}\\s*(=|\\+=|-=|\\*=|\\/=)`,
        'g',
      );
      const readerRe = new RegExp(`\\bexport\\s+function\\s+([a-zA-Z_$][\\w$]*)\\s*\\([^)]*\\)[^{]*\\{[\\s\\S]*?\\b${name}\\b`, 'g');
      const writers: string[] = [];
      const readers: string[] = [];

      for (;;) {
        const mm = writerRe.exec(file.sourceText);

        if (mm === null) {
          break;
        }

        writers.push(String(mm[1] ?? ''));
      }

      for (;;) {
        const mm = readerRe.exec(file.sourceText);

        if (mm === null) {
          break;
        }

        const fn = String(mm[1] ?? '');

        if (!writers.includes(fn)) {
          readers.push(fn);
        }
      }

      if (writers.length > 0 && readers.length > 0) {
        const offset = Math.max(0, m.index);

        // Emit per reader to satisfy "one writer feeds multiple readers".
        for (const _ of readers) {
          findings.push({
            kind: 'temporal-coupling',
            file: rel,
            span: spanForOffset(file.sourceText, offset),
            state: name,
            writers: writers.length,
            readers: readers.length,
          });
        }
      }

      continue;
    }

    // class init-guard: initialized property + init() method + query() method
    const initAssignRe = /\binitialized\s*=/;
    const initMethodRe = /\binit\b\s*\([^)]*\)[^{]*\{/;
    const queryMethodRe = /\bquery\b\s*\([^)]*\)[^{]*\{/;

    if (initAssignRe.test(file.sourceText) && initMethodRe.test(file.sourceText) && queryMethodRe.test(file.sourceText)) {
      const offset = Math.max(0, file.sourceText.indexOf('initialized'));

      findings.push({
        kind: 'temporal-coupling',
        file: rel,
        span: spanForOffset(file.sourceText, offset),
        state: 'initialized',
        writers: 1,
        readers: 1,
      });
    }
  }

  return findings;
};

export { analyzeTemporalCoupling, createEmptyTemporalCoupling };
