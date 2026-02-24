import type { Gildash } from '@zipbul/gildash';
import { isErr } from '@zipbul/result';

import type { ParsedFile } from '../../engine/types';
import type { ModificationImpactFinding } from '../../types';

import { normalizeFile } from '../../engine/ast/normalize-file';

const createEmptyModificationImpact = (): ReadonlyArray<ModificationImpactFinding> => [];

interface ExportRef {
  readonly fileIndex: number;
  readonly name: string;
  readonly span: { readonly start: { readonly line: number; readonly column: number }; readonly end: { readonly line: number; readonly column: number } };
}

const layerOf = (relPath: string): string => {
  if (relPath.startsWith('src/adapters/')) {
    return 'adapters';
  }

  if (relPath.startsWith('src/application/')) {
    return 'application';
  }

  if (relPath.startsWith('src/infrastructure/')) {
    return 'infrastructure';
  }

  if (relPath.startsWith('src/ports/')) {
    return 'ports';
  }

  return 'src';
};

const analyzeModificationImpact = async (
  gildash: Gildash,
  files: ReadonlyArray<ParsedFile>,
  rootAbs: string,
): Promise<ReadonlyArray<ModificationImpactFinding>> => {
  if (files.length === 0) {
    return createEmptyModificationImpact();
  }

  const relPaths = files.map(f => normalizeFile(f.filePath));
  const relPathToIndex = new Map<string, number>();

  for (let i = 0; i < relPaths.length; i++) {
    const p = relPaths[i] ?? '';

    if (p.length > 0) {
      relPathToIndex.set(p, i);
    }
  }

  /* ── Exports from gildash ── */

  const allExported = gildash.searchSymbols({ isExported: true, limit: 100_000 });

  if (isErr(allExported)) {
    return createEmptyModificationImpact();
  }

  const exports: ExportRef[] = [];

  for (const sym of allExported) {
    const rel = normalizeFile(sym.filePath);
    const fileIndex = relPathToIndex.get(rel) ?? -1;

    if (fileIndex < 0) continue;

    const file = files[fileIndex];

    if (!file || file.errors.length > 0) continue;

    if (!rel.endsWith('.ts')) continue;

    exports.push({
      fileIndex,
      name: sym.name,
      span: sym.span,
    });
  }

  /* ── File-level dependency edges from gildash ── */

  const importRels = gildash.searchRelations({ type: 'imports', limit: 100_000 });

  if (isErr(importRels)) {
    return createEmptyModificationImpact();
  }

  const edges = new Map<number, number[]>();

  for (const rel of importRels) {
    const srcRel = normalizeFile(rel.srcFilePath);
    const dstRel = normalizeFile(rel.dstFilePath);
    const srcIdx = relPathToIndex.get(srcRel) ?? -1;
    const dstIdx = relPathToIndex.get(dstRel) ?? -1;

    if (srcIdx >= 0 && dstIdx >= 0) {
      edges.set(dstIdx, [...(edges.get(dstIdx) ?? []), srcIdx]);
    }
  }

  /* ── BFS for transitive impact ── */

  const findings: ModificationImpactFinding[] = [];

  for (const ex of exports) {
    const rel = relPaths[ex.fileIndex] ?? '';

    if (!rel.endsWith('.ts')) {
      continue;
    }

    const visited = new Set<number>();
    const queue: number[] = [...(edges.get(ex.fileIndex) ?? [])];

    while (queue.length > 0) {
      const cur = queue.shift() as number;

      if (visited.has(cur)) {
        continue;
      }

      visited.add(cur);

      for (const next of edges.get(cur) ?? []) {
        queue.push(next);
      }
    }

    const impactRadius = visited.size;

    if (impactRadius < 2) {
      continue;
    }

    const highRiskCallers = [...visited]
      .map(i => relPaths[i] ?? '')
      .filter(p => p.length > 0)
      .filter(p => {
        const callerLayer = layerOf(p);
        const calleeLayer = layerOf(rel);

        return calleeLayer === 'application' && (callerLayer === 'adapters' || callerLayer === 'infrastructure');
      });

    findings.push({
      kind: 'modification-impact',
      file: rel,
      span: ex.span,
      impactRadius,
      highRiskCallers,
    });
  }

  return findings;
};

export { analyzeModificationImpact, createEmptyModificationImpact };
