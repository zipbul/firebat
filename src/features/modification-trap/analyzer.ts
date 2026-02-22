import type { ParsedFile } from '../../engine/types';
import type { ModificationTrapFinding } from '../../types';

import { normalizeFile } from '../../engine/normalize-file';
import { getLineColumn } from '../../engine/source-position';

const createEmptyModificationTrap = (): ReadonlyArray<ModificationTrapFinding> => [];

const spanForOffset = (sourceText: string, offset: number) => {
  const start = getLineColumn(sourceText, Math.max(0, offset));
  const end = getLineColumn(sourceText, Math.min(sourceText.length, Math.max(0, offset + 1)));

  return { start, end };
};

const normalizeLabel = (raw: string): string => {
  const trimmed = raw.trim();
  // Strip quotes for string literals
  const quoted = /^['"]([^'"]+)['"]$/.exec(trimmed);

  if (quoted) {
    return String(quoted[1] ?? '');
  }

  return trimmed;
};

const extractCaseLabels = (sourceText: string): ReadonlyArray<string> => {
  const labels: string[] = [];
  const re = /\bcase\s+([^:]+)\s*:/g;

  for (;;) {
    const m = re.exec(sourceText);

    if (m === null) {
      break;
    }

    labels.push(normalizeLabel(String(m[1] ?? '')));
  }

  return labels;
};

const extractLiteralComparisons = (sourceText: string): ReadonlyArray<string> => {
  const labels: string[] = [];
  const re = /===\s*['"]([^'"]+)['"]/g;

  for (;;) {
    const m = re.exec(sourceText);

    if (m === null) {
      break;
    }

    labels.push(normalizeLabel(String(m[1] ?? '')));
  }

  return labels;
};

const analyzeModificationTrap = (files: ReadonlyArray<ParsedFile>): ReadonlyArray<ModificationTrapFinding> => {
  if (files.length === 0) {
    return createEmptyModificationTrap();
  }

  const patternToFiles = new Map<string, number[]>();

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

    const cases = extractCaseLabels(file.sourceText);
    const literals = extractLiteralComparisons(file.sourceText);
    const labelSet = [...new Set([...cases, ...literals])].sort();

    if (labelSet.length === 0) {
      // also treat repeated imports of a shared type as a trap
      const typeImportRe = /import\s+type\s+\{\s*([A-Z][A-Za-z0-9_]*)\s*\}\s+from\s+['"][^'"]+['"]/g;
      const importedTypes = new Set<string>();

      for (const m of file.sourceText.matchAll(typeImportRe)) {
        const typeName = String(m[1] ?? '');

        if (typeName.length > 0) {
          importedTypes.add(typeName);
        }
      }

      for (const typeName of importedTypes) {
        const key = `import-type:${typeName}`;

        patternToFiles.set(key, [...(patternToFiles.get(key) ?? []), i]);
      }

      continue;
    }

    const key = `labels:${labelSet.join('|')}`;

    patternToFiles.set(key, [...(patternToFiles.get(key) ?? []), i]);
  }

  const findings: ModificationTrapFinding[] = [];

  for (const idxs of patternToFiles.values()) {
    if (idxs.length < 2) {
      continue;
    }

    for (const idx of idxs) {
      const file = files[idx];

      if (!file) continue;

      const rel = normalizeFile(file.filePath);
      const offset = Math.max(0, file.sourceText.indexOf('switch') >= 0 ? file.sourceText.indexOf('switch') : 0);

      findings.push({
        kind: 'modification-trap',
        file: rel,
        span: spanForOffset(file.sourceText, offset),
        pattern: 'switch',
        occurrences: idxs.length,
      });
    }
  }

  return findings;
};

export { analyzeModificationTrap, createEmptyModificationTrap };
