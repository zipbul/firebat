import type { ParsedFile } from '../../engine/types';
import type { SymmetryBreakingFinding } from '../../types';

import { normalizeFile } from '../../engine/normalize-file';
import { getLineColumn } from '../../engine/source-position';

const createEmptySymmetryBreaking = (): ReadonlyArray<SymmetryBreakingFinding> => [];

const spanForOffset = (sourceText: string, offset: number) => {
  const start = getLineColumn(sourceText, Math.max(0, offset));
  const end = getLineColumn(sourceText, Math.min(sourceText.length, Math.max(0, offset + 1)));

  return { start, end };
};

const groupKeyAuto = (rel: string): string => {
  const normalized = rel.replaceAll('\\', '/');

  if (normalized.includes('/handlers/')) {
    return 'handlers';
  }

  if (normalized.includes('/controllers/')) {
    return 'controllers';
  }

  const parts = normalized.split('/');

  if (parts.length <= 1) {
    return normalized;
  }

  // Group by directory. Root src/*.ts should share group 'src'.
  if (parts[0] === 'src' && parts.length === 2) {
    return 'src';
  }

  return parts.slice(0, Math.max(1, parts.length - 1)).join('/');
};

const extractExportedHandlerLike = (sourceText: string): ReadonlyArray<{ readonly name: string; readonly offset: number }> => {
  const out: Array<{ readonly name: string; readonly offset: number }> = [];
  const re = /\bexport\s+function\s+([a-zA-Z_$][\w$]*(?:Handler|Controller))\s*\(/g;

  for (;;) {
    const m = re.exec(sourceText);

    if (m === null) {
      break;
    }

    out.push({ name: String(m[1] ?? ''), offset: m.index });
  }

  return out;
};

const extractCallSequence = (sourceText: string): ReadonlyArray<string> => {
  // Heuristic: list of foo(); calls inside a function body.
  const calls = (sourceText.match(/\b([a-zA-Z_$][\w$]*)\s*\(\s*\)\s*;/g) ?? []).map(s => s.replaceAll(/\s/g, ''));

  return calls.map(s => s.replaceAll('();', ''));
};

const analyzeSymmetryBreaking = (files: ReadonlyArray<ParsedFile>): ReadonlyArray<SymmetryBreakingFinding> => {
  if (files.length === 0) {
    return createEmptySymmetryBreaking();
  }

  type Item = {
    readonly fileIndex: number;
    readonly rel: string;
    readonly offset: number;
    readonly sequenceKey: string;
  };

  const groups = new Map<string, Item[]>();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (!file) continue;

    if (file.errors.length > 0) {
      continue;
    }

    const rel = normalizeFile(file.filePath);

    if (!rel.endsWith('.ts')) {
      continue;
    }

    const exports = extractExportedHandlerLike(file.sourceText);

    if (exports.length === 0) {
      continue;
    }

    const seq = extractCallSequence(file.sourceText);
    const sequenceKey = seq.join('>');
    const offset = exports[0]?.offset ?? 0;
    const key = groupKeyAuto(rel);
    const list = groups.get(key) ?? [];

    list.push({ fileIndex: i, rel, offset, sequenceKey });
    groups.set(key, list);
  }

  const findings: SymmetryBreakingFinding[] = [];

  for (const items of groups.values()) {
    if (items.length < 3) {
      continue;
    }

    const freq = new Map<string, number>();

    for (const it of items) {
      freq.set(it.sequenceKey, (freq.get(it.sequenceKey) ?? 0) + 1);
    }

    const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
    const majorityKey = sorted[0]?.[0] ?? '';
    const majorityCount = sorted[0]?.[1] ?? 0;

    if (majorityCount === items.length) {
      continue;
    }

    // Report outliers.
    for (const it of items) {
      if (it.sequenceKey === majorityKey) {
        continue;
      }

      const file = files[it.fileIndex];

      if (!file) continue;

      findings.push({
        kind: 'symmetry-breaking',
        file: it.rel,
        span: spanForOffset(file.sourceText, it.offset),
        group: majorityKey,
        signature: it.sequenceKey,
        majorityCount: items.filter(x => x.sequenceKey === majorityKey).length,
        outlierCount: items.filter(x => x.sequenceKey !== majorityKey).length,
      });
    }
  }

  // Fallback: return-structure deviation (simple numeric literal return)
  if (findings.length === 0) {
    const controllerFiles = files
      .map((f, idx) => ({ f, idx, rel: normalizeFile(f.filePath) }))
      .filter(x => x.rel.endsWith('.ts') && /\bexport\s+function\s+[a-zA-Z_$][\w$]*Controller\b/.test(x.f.sourceText));

    if (controllerFiles.length >= 3) {
      const returnKinds = new Map<number, string>();

      for (const x of controllerFiles) {
        const m = /return\s+([^;\n]+)\s*;/.exec(x.f.sourceText);

        returnKinds.set(x.idx, m ? String(m[1] ?? '').trim() : 'none');
      }

      const freq = new Map<string, number>();

      for (const v of returnKinds.values()) {
        freq.set(v, (freq.get(v) ?? 0) + 1);
      }

      const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
      const majority = sorted[0]?.[0] ?? '';

      for (const x of controllerFiles) {
        const kind = returnKinds.get(x.idx) ?? '';

        if (kind === majority) {
          continue;
        }

        const offset = Math.max(0, x.f.sourceText.indexOf('return'));

        findings.push({
          kind: 'symmetry-breaking',
          file: x.rel,
          span: spanForOffset(x.f.sourceText, offset),
          group: 'return-structure',
          signature: kind,
          majorityCount: freq.get(majority) ?? 0,
          outlierCount: 1,
        });
      }
    }
  }

  return findings;
};

export { analyzeSymmetryBreaking, createEmptySymmetryBreaking };
