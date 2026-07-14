import type { Gildash } from '@zipbul/gildash';
import type { Node } from 'oxc-parser';

import { normalizePath } from '@zipbul/gildash';
import { buildLineOffsets, getLineColumn } from '@zipbul/gildash';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { Visitor } from 'oxc-parser';

import type { ParsedFile } from '../../engine/types';
import type { BarrelFinding, SourceSpan } from '../../types';

import { getLiteralString, isOxcNode } from '../../engine/ast/oxc-ast-utils';
import { globToRegExp } from '../../shared/glob-regex';
import { asRecordOrNull } from '../../shared/json-guards';
import { createImportResolver, createWorkspacePackageMap, type ImportResolver } from './resolver';

interface BarrelOptions {
  readonly rootAbs: string;
  readonly ignoreGlobs?: ReadonlyArray<string>;
  readonly gildash?: Gildash;
}

const DEFAULT_IGNORE_GLOBS: ReadonlyArray<string> = [
  'node_modules/**',
  'dist/**',
  'test/**',
  '__test__/**',
  '__tests__/**',
  '**/*.spec.*',
  '**/*.test.*',
];

const isIndexFile = (filePath: string): boolean => {
  const normalized = normalizePath(filePath);

  return normalized.endsWith('/index.ts');
};

const toSpan = (sourceText: string, startOffset: number, endOffset: number): SourceSpan => {
  const offsets = buildLineOffsets(sourceText);

  return {
    start: getLineColumn(offsets, Math.max(0, startOffset)),
    end: getLineColumn(offsets, Math.max(0, endOffset)),
  };
};

const toNodeSpan = (file: ParsedFile, node: unknown): SourceSpan => {
  const nodeRecord = asRecordOrNull(node);
  const startOffset = typeof nodeRecord?.start === 'number' ? nodeRecord.start : 0;
  const endOffset = typeof nodeRecord?.end === 'number' ? nodeRecord.end : startOffset;

  return toSpan(file.sourceText, startOffset, endOffset);
};

const SYNTHETIC_SPAN: SourceSpan = {
  start: { line: 1, column: 1 },
  end: { line: 1, column: 1 },
};

const compileIgnoreMatchers = (globs: ReadonlyArray<string>): ReadonlyArray<RegExp> => {
  return globs
    .map(g => (typeof g === 'string' ? g.trim() : ''))
    .filter(g => g.length > 0)
    .map(globToRegExp);
};

const isIgnored = (rootAbs: string, fileAbs: string, matchers: ReadonlyArray<RegExp>): boolean => {
  const rel = normalizePath(path.relative(rootAbs, fileAbs));

  // Outside root -> don't ignore here (treat as external)
  if (rel.startsWith('..')) {
    return false;
  }

  return matchers.some(re => re.test(rel));
};

const createEmptyBarrel = (): ReadonlyArray<BarrelFinding> => [];

// ─── export-star (D14: `export * as ns from` / `export type * as ns from` exempt) ──

const checkExportStar = (file: ParsedFile, findings: BarrelFinding[]): void => {
  new Visitor({
    ExportAllDeclaration(node) {
      // D14: the `* as ns` forms gain exactly one enumerable name, satisfying
      // clause ③ — exempt from export-star (still subject to the origin rule
      // via cross-module-reexport, handled separately).
      if (node.exported !== null && node.exported !== undefined) {
        return;
      }

      findings.push({
        kind: 'export-star',
        file: file.filePath,
        span: toNodeSpan(file, node),
      });
    },
  }).visit(file.program);
};

// ─── index.ts surface strictness (D4/D5/D13/D14) ─────────────────────────────

const checkIndexStrictness = (file: ParsedFile, findings: BarrelFinding[]): void => {
  if (!isIndexFile(file.filePath)) {
    return;
  }

  if (!isOxcNode(file.program) || file.program.type !== 'Program') {
    return;
  }

  for (const stmt of file.program.body as ReadonlyArray<Node>) {
    // D4: ExportAllDeclaration fires export-star only (checkExportStar), never
    // invalid-index-statement — regardless of the D14 `* as ns` exemption.
    if (stmt.type === 'ExportAllDeclaration') {
      continue;
    }

    if (stmt.type === 'ImportDeclaration') {
      const specifiers = stmt.specifiers as ReadonlyArray<Node>;
      const evidence = specifiers.length === 0 ? 'side-effect-import' : 'ImportDeclaration';

      findings.push({
        kind: 'invalid-index-statement',
        file: file.filePath,
        span: toNodeSpan(file, stmt),
        evidence,
      });

      continue;
    }

    if (stmt.type === 'ExportNamedDeclaration') {
      // D5/D13: conforming iff it has a source AND no declaration — covers
      // `export {…} from`, `export type {…} from`, alias/`default as`/`type`
      // specifier forms. Everything else (sourceless `export { local }`,
      // `export const x = …`, …) is invalid.
      const source = getLiteralString(stmt.source);
      const declaration = stmt.declaration;
      const conforming = typeof source === 'string' && (declaration === null || declaration === undefined);

      if (conforming) {
        continue;
      }

      findings.push({
        kind: 'invalid-index-statement',
        file: file.filePath,
        span: toNodeSpan(file, stmt),
        evidence: stmt.type,
      });

      continue;
    }

    // Everything else is invalid in a strict index barrel.
    findings.push({
      kind: 'invalid-index-statement',
      file: file.filePath,
      span: toNodeSpan(file, stmt),
      evidence: stmt.type,
    });
  }
};

// ─── shared ImportDeclaration resolution pass (D11/D2/D3/D17) ────────────────

interface ImportDeclarationEntry {
  readonly specifier: string;
  readonly span: SourceSpan;
}

/** Collect ImportDeclaration edges only — re-export edges never reach this list (D11). */
const collectImportDeclarations = (file: ParsedFile): ReadonlyArray<ImportDeclarationEntry> => {
  const items: ImportDeclarationEntry[] = [];

  new Visitor({
    ImportDeclaration(node) {
      const spec = getLiteralString(node.source);

      if (typeof spec === 'string') {
        items.push({ specifier: spec, span: toNodeSpan(file, node) });
      }
    },
  }).visit(file.program);

  return items;
};

interface ResolvedImportEdge {
  readonly file: ParsedFile;
  readonly importerAbs: string;
  readonly importerDirAbs: string;
  readonly span: SourceSpan;
  readonly targetDirAbs: string;
  readonly targetIsIndex: boolean;
}

/** Resolve every ImportDeclaration edge to its internal target (unresolved/external held). */
const resolveImportEdges = async (
  activeFiles: ReadonlyArray<ParsedFile>,
  resolver: ImportResolver,
  fileSet: ReadonlySet<string>,
): Promise<ReadonlyArray<ResolvedImportEdge>> => {
  const edges: ResolvedImportEdge[] = [];

  for (const file of activeFiles) {
    const importerAbs = normalizePath(file.filePath);
    const importerDirAbs = normalizePath(path.dirname(importerAbs));
    const entries = collectImportDeclarations(file);

    for (const entry of entries) {
      const resolved = await resolver.resolve(importerAbs, entry.specifier);

      if (!resolved) {
        // Unresolved: treat as external (npm) / held (D8).
        continue;
      }

      const targetAbs = normalizePath(resolved);

      if (!fileSet.has(targetAbs)) {
        continue;
      }

      edges.push({
        file,
        importerAbs,
        importerDirAbs,
        span: entry.span,
        targetDirAbs: normalizePath(path.dirname(targetAbs)),
        targetIsIndex: isIndexFile(targetAbs),
      });
    }
  }

  return edges;
};

/** Segment-safe: targetDir is importerDir itself, or a proper ancestor of it. */
const isSelfOrAncestorDir = (importerDirAbs: string, targetDirAbs: string): boolean =>
  importerDirAbs === targetDirAbs || importerDirAbs.startsWith(`${targetDirAbs}/`);

const toAllowedBarrelSpecifier = (
  importerFileAbs: string,
  targetDirAbs: string,
  workspacePackages: ReadonlyMap<string, string>,
): string | null => {
  // Prefer workspace package specifier if targetDir is within any workspace
  // package root. With overlapping/nested package roots (e.g. `packages/a`
  // and `packages/a/nested`, both containing a package.json), more than one
  // root can contain targetDir — pick the LONGEST (most specific) matching
  // root deterministically (F7), not the first one encountered in Map
  // iteration order (readdir / declaration order is not a decision fact).
  let bestPkgName: string | null = null;
  let bestPkgRootAbs: string | null = null;

  for (const [pkgName, pkgRootAbs] of workspacePackages.entries()) {
    const rel = normalizePath(path.relative(pkgRootAbs, targetDirAbs));

    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      continue;
    }

    if (bestPkgRootAbs === null || pkgRootAbs.length > bestPkgRootAbs.length) {
      bestPkgName = pkgName;
      bestPkgRootAbs = pkgRootAbs;
    }
  }

  if (bestPkgName !== null && bestPkgRootAbs !== null) {
    const rel = normalizePath(path.relative(bestPkgRootAbs, targetDirAbs));

    return rel.length === 0 ? bestPkgName : `${bestPkgName}/${rel}`;
  }

  const rel = normalizePath(path.relative(path.dirname(importerFileAbs), targetDirAbs));

  if (!rel.startsWith('.')) {
    return `./${rel}`;
  }

  return rel;
};

/** D2 (deep-import gates) + D3/D17 (demand-driven missing-index) over one shared edge list. */
const computeDeepImportAndMissingIndex = (
  edges: ReadonlyArray<ResolvedImportEdge>,
  fileSet: ReadonlySet<string>,
  workspacePackages: ReadonlyMap<string, string>,
): { readonly deepImport: ReadonlyArray<BarrelFinding>; readonly missingIndex: ReadonlyArray<BarrelFinding> } => {
  const deepImport: BarrelFinding[] = [];
  const demandDirs = new Set<string>();

  for (const edge of edges) {
    // (a) resolved target is an index.ts -> never a finding, never demand.
    if (edge.targetIsIndex) {
      continue;
    }

    // (b)+(c) target dir is the importer's own dir, or an ancestor of it -> K,
    // and creates no demand (D17: consuming a nested surface via a directory
    // specifier is legal regardless of ancestor dirs' index state).
    if (isSelfOrAncestorDir(edge.importerDirAbs, edge.targetDirAbs)) {
      continue;
    }

    // (d) target dir must contain an index.ts; otherwise missing-index owns
    // it. A fileSet miss conflates "not in this scan's file set" with
    // "absent on disk": with explicit file targets (a changed-files run) an
    // index.ts can exist on disk while simply not being part of `program`.
    // Probe disk on a fileSet miss (F4) — virtual-path programs (goldens use
    // /virtual/...) never exist on disk, so this probe never engages for
    // them and golden behavior is unchanged. If the index exists on disk,
    // this dir/edge can't be judged from this scan alone: hold BOTH
    // missing-index and deep-import for it (FN direction — never demand,
    // never suggest a deep-import fix that can't be verified).
    const targetIndexAbs = normalizePath(path.join(edge.targetDirAbs, 'index.ts'));

    if (!fileSet.has(targetIndexAbs)) {
      if (existsSync(targetIndexAbs)) {
        continue;
      }

      demandDirs.add(edge.targetDirAbs);

      continue;
    }

    const suggested = toAllowedBarrelSpecifier(edge.importerAbs, edge.targetDirAbs, workspacePackages);

    deepImport.push({
      kind: 'deep-import',
      file: edge.file.filePath,
      span: edge.span,
      ...(suggested ? { evidence: `suggest: ${suggested}` } : {}),
    });
  }

  const missingIndex: BarrelFinding[] = [...demandDirs].map(dir => ({
    kind: 'missing-index',
    file: dir,
    span: SYNTHETIC_SPAN,
    evidence: dir,
  }));

  return { deepImport, missingIndex };
};

// ─── cross-module-reexport detection (D6/D11/D14 clause ④) ──────────────────

interface ImportedBinding {
  readonly source: string; // specifier string (e.g. '../other')
  readonly localName: string;
}

const collectImportBindings = (file: ParsedFile): Map<string, ImportedBinding> => {
  // Map: local name → { source, localName }
  const result = new Map<string, ImportedBinding>();

  if (!isOxcNode(file.program) || file.program.type !== 'Program') {
    return result;
  }

  for (const stmt of file.program.body as ReadonlyArray<Node>) {
    if (stmt.type !== 'ImportDeclaration') {
      continue;
    }

    const source = getLiteralString(stmt.source as Node | null | undefined);

    if (typeof source !== 'string') {
      continue;
    }

    for (const spec of stmt.specifiers) {
      const localName = spec.local.name;

      result.set(localName, { source, localName });
    }
  }

  return result;
};

const isChildPath = (currentFileAbs: string, resolvedTargetAbs: string): boolean => {
  const currentDir = normalizePath(path.dirname(currentFileAbs));
  const target = normalizePath(resolvedTargetAbs);

  return target.startsWith(`${currentDir}/`);
};

/**
 * Build a set of files that have cross-module re-exports from gildash relations.
 * Files NOT in this set can skip AST-based cross-module-reexport detection entirely.
 */
const buildCrossModuleReexportFiles = (gildash: Gildash, rootAbs: string, fileSet: ReadonlySet<string>): Set<string> | null => {
  let rels: ReturnType<Gildash['searchRelations']>;

  try {
    rels = gildash.searchRelations({ type: 're-exports' });
  } catch {
    return null;
  }

  const result = new Set<string>();

  for (const rel of rels) {
    if (rel.dstFilePath === null) {
      continue;
    }

    const srcAbs = normalizePath(path.resolve(rootAbs, rel.srcFilePath));
    const dstAbs = normalizePath(path.resolve(rootAbs, rel.dstFilePath));

    if (!fileSet.has(dstAbs)) {
      continue;
    }

    if (isChildPath(srcAbs, dstAbs)) {
      continue;
    }

    result.add(srcAbs);
  }

  return result;
};

const checkCrossModuleReexport = async (
  activeFiles: ReadonlyArray<ParsedFile>,
  resolver: ImportResolver,
  fileSet: ReadonlySet<string>,
  findings: BarrelFinding[],
  crossModuleFiles: Set<string> | null,
): Promise<void> => {
  for (const file of activeFiles) {
    const fileAbs = normalizePath(file.filePath);

    // .d.ts 파일 방어
    if (fileAbs.endsWith('.d.ts')) {
      continue;
    }

    // gildash가 이 파일에 cross-module re-export 없다고 판단하면 구문 A 건너뛰기
    // (구문 B/C는 import+export 패턴이라 gildash re-export relation에 안 잡힐 수 있으므로 유지)
    const skipPatternA = crossModuleFiles !== null && !crossModuleFiles.has(fileAbs);
    const body = asRecordOrNull(file.program)?.body;

    if (!Array.isArray(body)) {
      continue;
    }

    // 구문 A: ExportNamedDeclaration with source, ExportAllDeclaration (D14: the
    // `* as ns` exemption governs export-star only — origin rule ④ still applies).
    if (!skipPatternA) {
      for (const stmt of body) {
        const stmtNode = stmt as Node;

        if (stmtNode.type !== 'ExportNamedDeclaration' && stmtNode.type !== 'ExportAllDeclaration') {
          continue;
        }

        const source = getLiteralString(stmtNode.source);

        if (typeof source !== 'string') {
          continue;
        }

        const resolved = await resolver.resolve(fileAbs, source);

        if (!resolved) {
          continue;
        }

        if (!fileSet.has(normalizePath(resolved))) {
          continue;
        }

        if (isChildPath(fileAbs, resolved)) {
          continue;
        }

        findings.push({
          kind: 'cross-module-reexport',
          file: file.filePath,
          span: toNodeSpan(file, stmt),
          evidence: source,
        });
      }
    }

    // 구문 B, C: import 바인딩 수집 후 export 분석 (D6: locallyUsed 예외 없음 — 로컬
    // 사용 여부와 무관하게 항상 발화)
    const importBindings = collectImportBindings(file);

    if (importBindings.size === 0) {
      continue;
    }

    for (const stmt of body) {
      const stmtNode = stmt as Node;

      // 구문 B: ExportNamedDeclaration without source
      if (stmtNode.type === 'ExportNamedDeclaration') {
        if (stmtNode.source !== null) {
          continue;
        }

        // Contract: one finding per (statement, origin source) — multiple
        // specifiers sharing the same foreign origin in one statement are
        // one decision, not one-per-specifier. Different origins in the same
        // statement still produce distinct findings (tracked per source).
        const pushedSources = new Set<string>();

        for (const spec of stmtNode.specifiers) {
          const localNode = spec.local;

          if (localNode.type !== 'Identifier') {
            continue;
          }

          const localName = localNode.name;

          if (typeof localName !== 'string') {
            continue;
          }

          const binding = importBindings.get(localName);

          if (!binding) {
            continue;
          }

          // 이 import가 모듈 밖인지 확인
          const resolved = await resolver.resolve(fileAbs, binding.source);

          if (!resolved) {
            continue;
          }

          if (!fileSet.has(normalizePath(resolved))) {
            continue;
          }

          if (isChildPath(fileAbs, resolved)) {
            continue;
          }

          if (pushedSources.has(binding.source)) {
            continue;
          }

          pushedSources.add(binding.source);

          // cross-module reexport → 탐지 (D6: locallyUsed 예외 삭제)
          findings.push({
            kind: 'cross-module-reexport',
            file: file.filePath,
            span: toNodeSpan(file, stmt),
            evidence: binding.source,
          });
        }

        continue;
      }

      // 구문 C: ExportDefaultDeclaration — declaration이 Identifier
      if (stmtNode.type === 'ExportDefaultDeclaration') {
        const declaration = stmtNode.declaration;

        if (declaration.type !== 'Identifier') {
          continue;
        }

        const identName = declaration.name;
        const binding = importBindings.get(identName);

        if (!binding) {
          continue;
        }

        const resolved = await resolver.resolve(fileAbs, binding.source);

        if (!resolved) {
          continue;
        }

        if (!fileSet.has(normalizePath(resolved))) {
          continue;
        }

        if (isChildPath(fileAbs, resolved)) {
          continue;
        }

        findings.push({
          kind: 'cross-module-reexport',
          file: file.filePath,
          span: toNodeSpan(file, stmt),
          evidence: binding.source,
        });
      }
    }
  }
};

const analyzeBarrel = async (
  program: ReadonlyArray<ParsedFile>,
  options: BarrelOptions,
): Promise<ReadonlyArray<BarrelFinding>> => {
  if (!Array.isArray(program) || program.length === 0) {
    return createEmptyBarrel();
  }

  const ignoreMatchers = compileIgnoreMatchers(options.ignoreGlobs ?? [...DEFAULT_IGNORE_GLOBS]);
  const activeFiles = program.filter(file => !isIgnored(options.rootAbs, file.filePath, ignoreMatchers));
  const fileSet = new Set<string>();

  for (const file of activeFiles) {
    fileSet.add(normalizePath(file.filePath));
  }

  const workspacePackages = await createWorkspacePackageMap(options.rootAbs);
  const resolver = createImportResolver({
    rootAbs: options.rootAbs,
    fileSet,
    workspacePackages,
  });
  const crossModuleFiles = options.gildash ? buildCrossModuleReexportFiles(options.gildash, options.rootAbs, fileSet) : null;
  const findings: BarrelFinding[] = [];

  for (const file of activeFiles) {
    checkExportStar(file, findings);
    checkIndexStrictness(file, findings);
  }

  // Single shared resolution pass over ImportDeclaration edges (D11) feeds both
  // deep-import (D2) and demand-driven missing-index (D3/D17) — no split-brain
  // double resolve.
  const edges = await resolveImportEdges(activeFiles, resolver, fileSet);
  const { deepImport, missingIndex } = computeDeepImportAndMissingIndex(edges, fileSet, workspacePackages);

  findings.push(...missingIndex, ...deepImport);

  await checkCrossModuleReexport(activeFiles, resolver, fileSet, findings, crossModuleFiles);

  return findings;
};

export { analyzeBarrel, createEmptyBarrel };
