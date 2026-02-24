import type { ParsedFile } from '../../engine/types';
import type { AbstractionFitnessFinding } from '../../types';

import { normalizeFile } from '../../engine/ast/normalize-file';

const createEmptyAbstractionFitness = (): ReadonlyArray<AbstractionFitnessFinding> => [];

interface AnalyzeAbstractionFitnessOptions {
  readonly minFitnessScore: number;
}

const folderOf = (relPath: string): string => {
  const normalized = relPath.replaceAll('\\', '/');
  const parts = normalized.split('/');

  // 'src/<folder>/...'
  if (parts.length >= 2) {
    // Special-case: 'src/a.ts' should group under 'src'
    if (parts.length === 2) {
      return parts[0] as string;
    }

    return `${parts[0]}/${parts[1]}`;
  }

  return normalized;
};

const analyzeAbstractionFitness = (
  files: ReadonlyArray<ParsedFile>,
  options: AnalyzeAbstractionFitnessOptions,
): ReadonlyArray<AbstractionFitnessFinding> => {
  if (files.length === 0) {
    return createEmptyAbstractionFitness();
  }

  const minFitnessScore = options.minFitnessScore;
  const relPaths = files.map(f => normalizeFile(f.filePath));
  // Build file import relations
  const importsFrom = new Map<number, ReadonlyArray<string>>();
  const importRe = /import\s+[^;]*\s+from\s+['"]([^'"]+)['"]/g;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (file === undefined) continue;
    if (file.errors.length > 0) continue;

    const rel = relPaths[i] ?? '';

    if (!rel.endsWith('.ts')) continue;

    const froms: string[] = [];

    for (;;) {
      const m = importRe.exec(file.sourceText);

      if (m === null) break;

      const from = String(m[1] ?? '');

      if (from.startsWith('.')) {
        froms.push(from);
      }
    }

    importRe.lastIndex = 0;

    importsFrom.set(i, froms);
  }

  const folderToMembers = new Map<string, number[]>();

  for (let i = 0; i < relPaths.length; i++) {
    const rel = relPaths[i] ?? '';

    if (!rel.endsWith('.ts')) {
      continue;
    }

    const folder = folderOf(rel);

    folderToMembers.set(folder, [...(folderToMembers.get(folder) ?? []), i]);
  }

  const findings: AbstractionFitnessFinding[] = [];

  for (const [folder, members] of folderToMembers.entries()) {
    let internalCohesion = 0;
    let externalCoupling = 0;
    let totalImports = 0;

    for (const idx of members) {
      const rel = relPaths[idx] ?? '';
      const froms = importsFrom.get(idx) ?? [];

      for (const from of froms) {
        if (from.startsWith('../')) {
          externalCoupling += 1;
        } else {
          internalCohesion += 1;
        }

        totalImports += 1;
      }

      if (rel.includes('/application/') || rel.includes('/adapters/') || rel.includes('/infrastructure/')) {
        externalCoupling += 1;
      }
    }

    const penalty = totalImports > 0 ? members.length : 0;
    const fitness = internalCohesion - externalCoupling - penalty;

    if (!(fitness < minFitnessScore)) {
      continue;
    }

    const idx = members[0] as number;
    const file = files[idx];

    if (file === undefined) {
      continue;
    }

    const rel = relPaths[idx] ?? '';

    findings.push({
      kind: 'abstraction-fitness',
      file: rel,
      span: { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } },
      module: folder,
      internalCohesion,
      externalCoupling,
      fitness,
    });
  }

  return findings;
};

export { analyzeAbstractionFitness, createEmptyAbstractionFitness };
