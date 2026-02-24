/**
 * Builds a mock Gildash instance from test source files.
 *
 * Parses import/export declarations via regex to produce the minimal
 * searchRelations / searchSymbols responses the forwarding analyzer needs.
 */
import type { Gildash, CodeRelation, SymbolSearchResult } from '@zipbul/gildash';

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

const resolveSpecifier = (fromPath: string, specifier: string): string => {
  if (!specifier.startsWith('.')) return specifier;

  const dir = fromPath.replace(/\/[^/]+$/, '');
  const segments = [...dir.split('/'), ...specifier.split('/')];
  const resolved: string[] = [];

  for (const seg of segments) {
    if (seg === '.') continue;

    if (seg === '..') {
      resolved.pop();
    } else {
      resolved.push(seg);
    }
  }

  let result = resolved.join('/');

  if (!/\.\w+$/.test(result)) {
    result += '.ts';
  }

  return result;
};

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export const buildMockGildashFromSources = (
  sources: Map<string, string> | Record<string, string>,
): Gildash => {
  const relations: CodeRelation[] = [];
  const symbols: SymbolSearchResult[] = [];
  let symbolId = 0;

  const entries: Array<[string, string]> =
    sources instanceof Map ? [...sources.entries()] : Object.entries(sources);

  for (const [filePath, source] of entries) {
    // ── Import: namespace ──
    // import * as NS from './path'
    for (const m of source.matchAll(/import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g)) {
      relations.push({
        type: 'imports',
        srcFilePath: filePath,
        srcSymbolName: m[1]!,
        dstFilePath: resolveSpecifier(filePath, m[2]!),
        dstSymbolName: null,
      } as CodeRelation);
    }

    // ── Import: named (possibly aliased) ──
    // import { a, b as b2 } from './path'
    for (const m of source.matchAll(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g)) {
      const resolved = resolveSpecifier(filePath, m[2]!);

      for (const binding of m[1]!.split(',')) {
        const parts = binding.trim().split(/\s+as\s+/);
        const exportedName = parts[0]!.trim();
        const localName = (parts[1] ?? parts[0]!).trim();

        relations.push({
          type: 'imports',
          srcFilePath: filePath,
          srcSymbolName: localName,
          dstFilePath: resolved,
          dstSymbolName: exportedName,
        } as CodeRelation);
      }
    }

    // ── Exports ──
    // export function|const|let|var|class NAME
    for (const m of source.matchAll(/export\s+(?:function|const|let|var|class)\s+(\w+)/g)) {
      symbolId += 1;
      symbols.push({
        id: symbolId,
        filePath,
        kind: 'function' as SymbolSearchResult['kind'],
        name: m[1]!,
        span: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
        isExported: true,
        signature: null,
        fingerprint: null,
        detail: {},
      } as SymbolSearchResult);
    }
  }

  /* ── Reverse adjacency for getAffected ── */
  const reverseAdj = new Map<string, string[]>();

  for (const rel of relations) {
    if (rel.type !== 'imports') continue;

    let list = reverseAdj.get(rel.dstFilePath);

    if (!list) {
      list = [];
      reverseAdj.set(rel.dstFilePath, list);
    }

    if (!list.includes(rel.srcFilePath)) {
      list.push(rel.srcFilePath);
    }
  }

  const getTransitiveDependents = (filePath: string): string[] => {
    const visited = new Set<string>();
    const queue = [filePath];

    while (queue.length > 0) {
      const current = queue.shift()!;

      for (const dep of reverseAdj.get(current) ?? []) {
        if (!visited.has(dep)) {
          visited.add(dep);
          queue.push(dep);
        }
      }
    }

    return Array.from(visited);
  };

  return {
    searchRelations: () => relations,
    searchSymbols: () => symbols,
    getAffected: async (changedFiles: string[]) => {
      const all = new Set<string>();

      for (const f of changedFiles) {
        for (const dep of getTransitiveDependents(f)) {
          all.add(dep);
        }
      }

      return Array.from(all);
    },
  } as unknown as Gildash;
};
