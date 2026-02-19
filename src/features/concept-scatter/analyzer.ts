import type { ParsedFile } from '../../engine/types';
import type { ConceptScatterFinding } from '../../types';

import { getLineColumn } from '../../engine/source-position';

const createEmptyConceptScatter = (): ReadonlyArray<ConceptScatterFinding> => [];

const normalizeFile = (filePath: string): string => {
  const normalized = filePath.replaceAll('\\', '/');
  const idx = normalized.lastIndexOf('/src/');

  if (idx >= 0) {
    return normalized.slice(idx + 1);
  }

  return normalized;
};

const spanForOffset = (sourceText: string, offset: number) => {
  const start = getLineColumn(sourceText, Math.max(0, offset));
  const end = getLineColumn(sourceText, Math.min(sourceText.length, Math.max(0, offset + 1)));

  return { start, end };
};

interface AnalyzeConceptScatterOptions {
  readonly maxScatterIndex: number;
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

const tokenizeConcepts = (input: string): ReadonlyArray<string> => {
  const raw = input
    .replaceAll(/[^a-zA-Z0-9]/g, ' ')
    .split(' ')
    .map(s => s.trim())
    .filter(Boolean);
  const concepts: string[] = [];

  for (const token of raw) {
    // Split camelCase / PascalCase
    const parts = token.split(/(?=[A-Z])/).map(s => s.toLowerCase());

    for (const p of parts) {
      if (p.length < 3) {
        continue;
      }

      concepts.push(p);
    }
  }

  return concepts;
};

const analyzeConceptScatter = (
  files: ReadonlyArray<ParsedFile>,
  options: AnalyzeConceptScatterOptions,
): ReadonlyArray<ConceptScatterFinding> => {
  if (files.length === 0) {
    return createEmptyConceptScatter();
  }

  const maxScatterIndex = Math.max(0, Math.floor(options.maxScatterIndex));
  const conceptToFiles = new Map<string, Set<string>>();
  const conceptToLayers = new Map<string, Set<string>>();

  for (const file of files) {
    if (file.errors.length > 0) {
      continue;
    }

    const rel = normalizeFile(file.filePath);

    if (!rel.endsWith('.ts')) {
      continue;
    }

    const layer = layerOf(rel);
    const concepts = new Set<string>([...tokenizeConcepts(rel), ...tokenizeConcepts(file.sourceText)]);

    for (const c of concepts) {
      const filesSet = conceptToFiles.get(c) ?? new Set<string>();

      filesSet.add(rel);
      conceptToFiles.set(c, filesSet);

      const layersSet = conceptToLayers.get(c) ?? new Set<string>();

      layersSet.add(layer);
      conceptToLayers.set(c, layersSet);
    }
  }

  const findings: ConceptScatterFinding[] = [];

  for (const [concept, filesSet] of conceptToFiles.entries()) {
    const layersSet = conceptToLayers.get(concept) ?? new Set<string>();
    const scatterIndex = filesSet.size + layersSet.size;

    if (scatterIndex <= maxScatterIndex) {
      continue;
    }

    const anyFile = [...filesSet][0] ?? '';
    const fileObj = files.find(f => normalizeFile(f.filePath) === anyFile);
    const offset = fileObj ? Math.max(0, fileObj.sourceText.toLowerCase().indexOf(concept)) : 0;

    findings.push({
      kind: 'concept-scatter',
      file: anyFile,
      span: fileObj ? spanForOffset(fileObj.sourceText, offset) : spanForOffset('', 0),
      concept,
      scatterIndex,
      files: [...filesSet].sort(),
      layers: [...layersSet].sort(),
    });
  }

  return findings;
};

export { analyzeConceptScatter, createEmptyConceptScatter };
