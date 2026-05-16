import { is } from '@zipbul/gildash';
import type { Gildash } from '@zipbul/gildash';
import type { Node } from 'oxc-parser';

import { normalizePath } from '@zipbul/gildash';
import { buildLineOffsets, getLineColumn } from '@zipbul/gildash';
import * as path from 'node:path';
import { Visitor } from 'oxc-parser';

import type { ParsedFile } from '../../engine/types';
import type { BarrelFinding, SourceSpan } from '../../types';

import { collectLocallyUsedImportNames } from '../../engine/ast/collect-locally-used-import-names';
import { getLiteralString, isOxcNode } from '../../engine/ast/oxc-ast-utils';
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

type NodeLike = Record<string, unknown>;

const asNodeLike = (value: unknown): NodeLike | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return value as NodeLike;
};

const toNodeSpan = (file: ParsedFile, node: unknown): SourceSpan => {
  const nodeRecord = asNodeLike(node);
  const startOffset = typeof nodeRecord?.start === 'number' ? nodeRecord.start : 0;
  const endOffset = typeof nodeRecord?.end === 'number' ? nodeRecord.end : startOffset;

  return toSpan(file.sourceText, startOffset, endOffset);
};

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const globToRegExp = (glob: string): RegExp => {
  // Minimal glob support for ignore patterns.
  // - ** matches any chars (including '/')
  // - * matches any chars except '/'
  // - ? matches one char except '/'
  const normalized = normalizePath(glob);
  let out = '^';

  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized.charAt(i);

    if (ch === '*') {
      const next = normalized[i + 1];

      if (next !== '*') {
        out += '[^/]*';
      } else {
        out += '.*';
        i += 1;
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else {
      out += escapeRegex(ch);
    }
  }

  out += '$';

  return new RegExp(out);
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

type ImportLikeKind = 'import' | 'export-named' | 'export-all';

interface ImportLike {
  readonly kind: ImportLikeKind;
  readonly specifier: string;
  readonly span: SourceSpan;
  readonly rawNode: unknown;
}

const collectImportLikes = (file: ParsedFile): ReadonlyArray<ImportLike> => {
  const items: ImportLike[] = [];

  const addItem = (kind: ImportLikeKind, node: Node, source: Node | null | undefined): void => {
    const spec = getLiteralString(source);

    if (typeof spec === 'string') {
      items.push({ kind, specifier: spec, span: toNodeSpan(file, node), rawNode: node });
    }
  };

  new Visitor({
    ImportDeclaration(node) {
      addItem('import', node, node.source);
    },
    ExportNamedDeclaration(node) {
      addItem('export-named', node, node.source);
    },
    ExportAllDeclaration(node) {
      addItem('export-all', node, node.source);
    },
  }).visit(file.program);

  return items;
};

const isExplicitIndexSpecifier = (specifier: string): boolean => {
  const normalized = normalizePath(specifier);

  return normalized.endsWith('/index') || normalized.endsWith('/index.ts') || normalized === 'index' || normalized === 'index.ts';
};

const createEmptyBarrel = (): ReadonlyArray<BarrelFinding> => [];

const checkExportStar = (file: ParsedFile, findings: BarrelFinding[]): void => {
  new Visitor({
    ExportAllDeclaration(node) {
      findings.push({
        kind: 'export-star',
        file: file.filePath,
        span: toNodeSpan(file, node),
      });
    },
  }).visit(file.program);
};

const checkIndexStrictness = (file: ParsedFile, findings: BarrelFinding[]): void => {
  if (!isIndexFile(file.filePath)) {
    return;
  }

  if (!isOxcNode(file.program) || file.program.type !== 'Program') {
    return;
  }

  for (const stmt of file.program.body as ReadonlyArray<Node>) {
    if (is.ImportDeclaration(stmt)) {
      const specifiers = stmt.specifiers as ReadonlyArray<Node>;

      if (specifiers.length === 0) {
        const source = getLiteralString(stmt.source as Node | null | undefined);

        findings.push({
          kind: 'barrel-side-effect-import',
          file: file.filePath,
          span: toNodeSpan(file, stmt),
          ...(typeof source === 'string' ? { evidence: source } : {}),
        });
      }
    } else if (is.ExportNamedDeclaration(stmt)) {
      const source = getLiteralString(stmt.source);
      const declaration = stmt.declaration;

      if (!(typeof source === 'string' && (declaration === null || declaration === undefined))) {
        findings.push({
          kind: 'invalid-index-statement',
          file: file.filePath,
          span: toNodeSpan(file, stmt),
        });
      }
    } else if (is.ExportAllDeclaration(stmt)) {
      // ExportAllDeclaration is separately reported via export-star, but still invalid in barrel.
      findings.push({
        kind: 'invalid-index-statement',
        file: file.filePath,
        span: toNodeSpan(file, stmt),
      });
    } else {
      // Everything else is invalid in a strict index barrel.
      findings.push({
        kind: 'invalid-index-statement',
        file: file.filePath,
        span: toNodeSpan(file, stmt),
        evidence: stmt.type,
      });
    }
  }
};

const checkMissingIndex = (
  activeFiles: ReadonlyArray<ParsedFile>,
  fileSet: ReadonlySet<string>,
  findings: BarrelFinding[],
): void => {
  const dirs = new Set<string>();

  for (const file of activeFiles) {
    const normalized = normalizePath(file.filePath);

    if (!normalized.endsWith('.ts')) {
      continue;
    }

    const dir = normalizePath(path.dirname(normalized));

    dirs.add(dir);
  }

  for (const dir of dirs) {
    const indexTs = normalizePath(path.join(dir, 'index.ts'));

    if (fileSet.has(indexTs)) {
      continue;
    }

    findings.push({
      kind: 'missing-index',
      file: dir,
      span: {
        start: { line: 1, column: 1 },
        end: { line: 1, column: 1 },
      },
      evidence: dir,
    });
  }
};

const toAllowedBarrelSpecifier = (
  importerFileAbs: string,
  targetDirAbs: string,
  workspacePackages: ReadonlyMap<string, string>,
): string | null => {
  // Prefer workspace package specifier if targetDir is within any workspace package root.
  for (const [pkgName, pkgRootAbs] of workspacePackages.entries()) {
    const rel = normalizePath(path.relative(pkgRootAbs, targetDirAbs));

    if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
      return rel.length === 0 ? pkgName : `${pkgName}/${rel}`;
    }
  }

  const rel = normalizePath(path.relative(path.dirname(importerFileAbs), targetDirAbs));

  if (!rel.startsWith('.')) {
    return `./${rel}`;
  }

  return rel;
};

// ─── cross-module-reexport detection ─────────────────────────────────────────

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
    if (!is.ImportDeclaration(stmt)) {
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

  return target.startsWith(currentDir + '/');
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
    const body = asNodeLike(file.program)?.body;

    if (!Array.isArray(body)) {
      continue;
    }

    // 구문 A: ExportNamedDeclaration with source, ExportAllDeclaration
    if (!skipPatternA) {
      for (const stmt of body) {
        const stmtNode = stmt as Node;

        if (!is.ExportNamedDeclaration(stmtNode) && !is.ExportAllDeclaration(stmtNode)) {
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

    // 구문 B, C: import 바인딩 수집 후 export 분석
    const importBindings = collectImportBindings(file);

    if (importBindings.size === 0) {
      continue;
    }

    // scope-aware 로컬 사용 판별
    const importedNames = new Set(importBindings.keys());
    const locallyUsed = collectLocallyUsedImportNames(file.program, importedNames);

    for (const stmt of body) {
      const stmtNode = stmt as Node;

      // 구문 B: ExportNamedDeclaration without source
      if (is.ExportNamedDeclaration(stmtNode)) {
        if (stmtNode.source !== null) {
          continue;
        }

        for (const spec of stmtNode.specifiers) {
          const localNode = spec.local;

          if (!is.Identifier(localNode)) {
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

          // 로컬 사용 있으면 허용
          if (locallyUsed.has(localName)) {
            continue;
          }

          // cross-module reexport → 탐지
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
      if (is.ExportDefaultDeclaration(stmtNode)) {
        const declaration = stmtNode.declaration;

        if (!is.Identifier(declaration)) {
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

        if (locallyUsed.has(identName)) {
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

const checkDeepImports = async (
  activeFiles: ReadonlyArray<ParsedFile>,
  resolver: ImportResolver,
  workspacePackages: ReadonlyMap<string, string>,
  fileSet: ReadonlySet<string>,
  findings: BarrelFinding[],
): Promise<void> => {
  for (const file of activeFiles) {
    const importerAbs = normalizePath(file.filePath);
    const importerDirAbs = normalizePath(path.dirname(importerAbs));
    const importLikes = collectImportLikes(file);

    for (const entry of importLikes) {
      const resolved = await resolver.resolve(importerAbs, entry.specifier);

      if (!resolved) {
        // Unresolved: treat as external (npm) and ignore.
        continue;
      }

      if (!fileSet.has(normalizePath(resolved))) {
        continue;
      }

      const targetAbs = normalizePath(resolved);
      const targetDirAbs = normalizePath(path.dirname(targetAbs));

      if (targetDirAbs === importerDirAbs) {
        // same-directory imports are allowed.
        continue;
      }

      // If this import resolves to an index file, it must be imported via directory (not /index).
      if (isIndexFile(targetAbs) && isExplicitIndexSpecifier(entry.specifier)) {
        const suggested = toAllowedBarrelSpecifier(importerAbs, targetDirAbs, workspacePackages);

        findings.push({
          kind: 'index-deep-import',
          file: file.filePath,
          span: entry.span,
          ...(suggested ? { evidence: `suggest: ${suggested}` } : {}),
        });

        continue;
      }

      // If it resolves to a non-index file across directories, it is a deep import.
      if (!isIndexFile(targetAbs)) {
        const suggested = toAllowedBarrelSpecifier(importerAbs, targetDirAbs, workspacePackages);

        findings.push({
          kind: 'deep-import',
          file: file.filePath,
          span: entry.span,
          ...(suggested ? { evidence: `suggest: ${suggested}` } : {}),
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

  checkMissingIndex(activeFiles, fileSet, findings);

  await checkDeepImports(activeFiles, resolver, workspacePackages, fileSet, findings);
  await checkCrossModuleReexport(activeFiles, resolver, fileSet, findings, crossModuleFiles);

  return findings;
};

export { analyzeBarrel, createEmptyBarrel };
