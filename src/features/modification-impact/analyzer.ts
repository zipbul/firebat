import type { ParsedFile } from '../../engine/types';
import type { ModificationImpactFinding } from '../../types';

import { getLineColumn } from '../../engine/source-position';

const createEmptyModificationImpact = (): ReadonlyArray<ModificationImpactFinding> => [];

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

interface ExportRef {
  readonly fileIndex: number;
  readonly name: string;
  readonly offset: number;
}

const extractExports = (sourceText: string): ReadonlyArray<{ readonly name: string; readonly offset: number }> => {
  const out: Array<{ readonly name: string; readonly offset: number }> = [];
  const fnRe = /\bexport\s+function\s+([a-zA-Z_$][\w$]*)\b/g;

  for (;;) {
    const m = fnRe.exec(sourceText);

    if (m === null) {
      break;
    }

    out.push({ name: String(m[1] ?? ''), offset: m.index });
  }

  const constRe = /\bexport\s+const\s+([a-zA-Z_$][\w$]*)\b/g;

  for (;;) {
    const m = constRe.exec(sourceText);

    if (m === null) {
      break;
    }

    out.push({ name: String(m[1] ?? ''), offset: m.index });
  }

  const classRe = /\bexport\s+class\s+([a-zA-Z_$][\w$]*)\b/g;

  for (;;) {
    const m = classRe.exec(sourceText);

    if (m === null) {
      break;
    }

    out.push({ name: String(m[1] ?? ''), offset: m.index });
  }

  return out;
};

const extractImports = (sourceText: string): ReadonlyArray<{ readonly names: ReadonlyArray<string>; readonly from: string }> => {
  const out: Array<{ readonly names: ReadonlyArray<string>; readonly from: string }> = [];
  const re = /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;

  for (;;) {
    const m = re.exec(sourceText);

    if (m === null) {
      break;
    }

    const names = String(m[1] ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => s.split('\n').join(''));

    out.push({ names, from: String(m[2] ?? '') });
  }

  return out;
};

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

const dirname = (relPath: string): string => {
  const normalized = relPath.replaceAll('\\', '/');
  const idx = normalized.lastIndexOf('/');

  if (idx < 0) {
    return '';
  }

  return normalized.slice(0, idx);
};

const normalizePath = (path: string): string => {
  const parts = path.replaceAll('\\', '/').split('/');
  const out: string[] = [];

  for (const part of parts) {
    if (part === '' || part === '.') {
      continue;
    }

    if (part === '..') {
      out.pop();

      continue;
    }

    out.push(part);
  }

  return out.join('/');
};

const resolveRelativeImportToRelTs = (importerRel: string, from: string): string => {
  const baseDir = dirname(importerRel);
  const joined = baseDir.length > 0 ? `${baseDir}/${from}` : from;
  const normalized = normalizePath(joined);

  return normalized.endsWith('.ts') ? normalized : `${normalized}.ts`;
};

const analyzeModificationImpact = (files: ReadonlyArray<ParsedFile>): ReadonlyArray<ModificationImpactFinding> => {
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

  const exports: ExportRef[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (file.errors.length > 0) {
      continue;
    }

    const rel = relPaths[i] ?? '';

    if (!rel.endsWith('.ts')) {
      continue;
    }

    for (const e of extractExports(file.sourceText)) {
      exports.push({ fileIndex: i, name: e.name, offset: e.offset });
    }
  }

  // Build a dependency graph (file -> imported files)
  const edges = new Map<number, number[]>();
  const importersByExport = new Map<string, Set<number>>();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    if (file.errors.length > 0) {
      continue;
    }

    const imports = extractImports(file.sourceText);
    const importerRel = relPaths[i] ?? '';

    for (const imp of imports) {
      // Only support simple relative imports like "./a" or "../x".
      const from = imp.from;

      if (!from.startsWith('.')) {
        continue;
      }

      const candidate = resolveRelativeImportToRelTs(importerRel, from);
      const candidateIndex = normalizePath(candidate.replace(/\.ts$/, '/index.ts'));
      const targetIdx = relPathToIndex.get(candidate) ?? relPathToIndex.get(candidateIndex) ?? -1;

      if (targetIdx >= 0) {
        edges.set(targetIdx, [...(edges.get(targetIdx) ?? []), i]);
      }

      for (const name of imp.names) {
        const key = `${from}:${name}`;
        const set = importersByExport.get(key) ?? new Set<number>();

        set.add(i);
        importersByExport.set(key, set);
      }
    }
  }

  const findings: ModificationImpactFinding[] = [];

  for (const ex of exports) {
    const rel = relPaths[ex.fileIndex] ?? '';

    if (!rel.endsWith('.ts')) {
      continue;
    }

    // Compute transitive impact: number of reachable dependent files.
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

    // Threshold: report only if impact spreads beyond a single local caller.
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
    const file = files[ex.fileIndex];
    const offset = ex.offset;

    findings.push({
      kind: 'modification-impact',
      file: rel,
      span: spanForOffset(file.sourceText, offset),
      impactRadius,
      highRiskCallers,
    });
  }

  return findings;
};

export { analyzeModificationImpact, createEmptyModificationImpact };
