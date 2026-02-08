import * as path from 'node:path';

import type { ParsedFile } from '../../engine/types';
import type { BarrelPolicyAnalysis, BarrelPolicyFinding, SourceSpan } from '../../types';

import { getLiteralString, isNodeRecord, isOxcNode, walkOxcTree } from '../../engine/oxc-ast-utils';
import { getLineColumn } from '../../engine/source-position';

import { createImportResolver, createWorkspacePackageMap } from './resolver';

export interface BarrelPolicyOptions {
  readonly rootAbs: string;
  readonly ignoreGlobs?: ReadonlyArray<string>;
}

const DEFAULT_IGNORE_GLOBS: ReadonlyArray<string> = ['node_modules/**', 'dist/**'];

const normalizePath = (value: string): string => value.replaceAll('\\', '/');

const isIndexFile = (filePath: string): boolean => {
  const normalized = normalizePath(filePath);

  return normalized.endsWith('/index.ts') || normalized.endsWith('/index.tsx');
};

const toSpan = (sourceText: string, startOffset: number, endOffset: number): SourceSpan => {
  const start = getLineColumn(sourceText, Math.max(0, startOffset));
  const end = getLineColumn(sourceText, Math.max(0, endOffset));

  return { start, end };
};

const toNodeSpan = (file: ParsedFile, node: any): SourceSpan => {
  const startOffset = typeof node?.start === 'number' ? node.start : 0;
  const endOffset = typeof node?.end === 'number' ? node.end : startOffset;

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

      if (next === '*') {
        out += '.*';
        i += 1;

        continue;
      }

      out += '[^/]*';

      continue;
    }

    if (ch === '?') {
      out += '[^/]';

      continue;
    }

    out += escapeRegex(ch);
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
  if (rel.startsWith('..')) {return false;}

  return matchers.some(re => re.test(rel));
};

type ImportLikeKind = 'import' | 'export-named' | 'export-all';

type ImportLike = {
  readonly kind: ImportLikeKind;
  readonly specifier: string;
  readonly span: SourceSpan;
  readonly rawNode: any;
};

const collectImportLikes = (file: ParsedFile): ReadonlyArray<ImportLike> => {
  const items: ImportLike[] = [];

  walkOxcTree(file.program as any, node => {
    if (!isOxcNode(node)) {
      return false;
    }

    if (!isNodeRecord(node)) {
      return true;
    }

    if (node.type === 'ImportDeclaration') {
      const spec = getLiteralString((node as any).source);

      if (typeof spec === 'string') {
        items.push({
          kind: 'import',
          specifier: spec,
          span: toNodeSpan(file, node),
          rawNode: node,
        });
      }

      return true;
    }

    if (node.type === 'ExportNamedDeclaration') {
      const spec = getLiteralString((node as any).source);

      if (typeof spec === 'string') {
        items.push({
          kind: 'export-named',
          specifier: spec,
          span: toNodeSpan(file, node),
          rawNode: node,
        });
      }

      return true;
    }

    if (node.type === 'ExportAllDeclaration') {
      const spec = getLiteralString((node as any).source);

      if (typeof spec === 'string') {
        items.push({
          kind: 'export-all',
          specifier: spec,
          span: toNodeSpan(file, node),
          rawNode: node,
        });
      }

      return true;
    }

    return true;
  });

  return items;
};

const isExplicitIndexSpecifier = (specifier: string): boolean => {
  const normalized = normalizePath(specifier);

  return (
    normalized.endsWith('/index') ||
    normalized.endsWith('/index.ts') ||
    normalized.endsWith('/index.tsx') ||
    normalized === 'index' ||
    normalized === 'index.ts' ||
    normalized === 'index.tsx'
  );
};

export const createEmptyBarrelPolicy = (): BarrelPolicyAnalysis => ({ findings: [] });

const checkExportStar = (file: ParsedFile, findings: BarrelPolicyFinding[]): void => {
  walkOxcTree(file.program as any, node => {
    if (!isOxcNode(node)) {return false;}

    if (!isNodeRecord(node)) {return true;}

    if (node.type === 'ExportAllDeclaration') {
      findings.push({
        kind: 'export-star',
        message: 'export * is forbidden (use explicit re-exports only)',
        filePath: file.filePath,
        span: toNodeSpan(file, node),
      });
    }

    return true;
  });
};

const checkIndexStrictness = (file: ParsedFile, findings: BarrelPolicyFinding[]): void => {
  if (!isIndexFile(file.filePath)) {
    return;
  }

  const body = (file.program as any)?.body;

  if (!Array.isArray(body)) {
    return;
  }

  for (const stmt of body) {
    if (!stmt || typeof stmt !== 'object') {
      continue;
    }

    const type = (stmt as any).type;

    if (type === 'ExportNamedDeclaration') {
      const source = getLiteralString((stmt as any).source);
      const declaration = (stmt as any).declaration;

      if (typeof source === 'string' && (declaration === null || declaration === undefined)) {
        // Allow only: export { ... } from '...'; / export type { ... } from '...';
        continue;
      }

      findings.push({
        kind: 'invalid-index-statement',
        message: 'index barrel must only contain explicit re-exports: `export { .. } from` / `export type { .. } from`',
        filePath: file.filePath,
        span: toNodeSpan(file, stmt),
      });

      continue;
    }

    // ExportAllDeclaration is separately reported via export-star, but still invalid in barrel.
    if (type === 'ExportAllDeclaration') {
      findings.push({
        kind: 'invalid-index-statement',
        message: 'index barrel must not contain export * (use explicit re-exports)',
        filePath: file.filePath,
        span: toNodeSpan(file, stmt),
      });

      continue;
    }

    // Everything else is invalid in a strict index barrel.
    findings.push({
      kind: 'invalid-index-statement',
      message: 'index barrel must not contain imports, statements, or declarations (explicit re-exports only)',
      filePath: file.filePath,
      span: toNodeSpan(file, stmt),
      evidence: String(type ?? 'unknown'),
    });
  }
};

const checkMissingIndex = (activeFiles: ReadonlyArray<ParsedFile>, fileSet: ReadonlySet<string>, findings: BarrelPolicyFinding[]): void => {
  const dirs = new Set<string>();

  for (const file of activeFiles) {
    const normalized = normalizePath(file.filePath);

    if (!normalized.endsWith('.ts') && !normalized.endsWith('.tsx')) {
      continue;
    }

    const dir = normalizePath(path.dirname(normalized));

    dirs.add(dir);
  }

  for (const dir of dirs) {
    const indexTs = normalizePath(path.join(dir, 'index.ts'));
    const indexTsx = normalizePath(path.join(dir, 'index.tsx'));

    if (fileSet.has(indexTs) || fileSet.has(indexTsx)) {
      continue;
    }

    findings.push({
      kind: 'missing-index',
      message: 'directory must contain index.ts or index.tsx (strict barrel required)',
      filePath: dir,
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

const checkDeepImports = async (
  activeFiles: ReadonlyArray<ParsedFile>,
  resolver: { readonly resolve: (importerFileAbs: string, specifier: string) => Promise<string | null> },
  workspacePackages: ReadonlyMap<string, string>,
  fileSet: ReadonlySet<string>,
  findings: BarrelPolicyFinding[],
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
          message: 'imports must go through directory barrel (do not import index file explicitly)',
          filePath: file.filePath,
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
          message: 'direct imports across directories are forbidden (use the directory index barrel)',
          filePath: file.filePath,
          span: entry.span,
          ...(suggested ? { evidence: `suggest: ${suggested}` } : {}),
        });
      }
    }
  }
};

export const analyzeBarrelPolicy = async (
  program: ReadonlyArray<ParsedFile>,
  options: BarrelPolicyOptions,
): Promise<BarrelPolicyAnalysis> => {
  if (!Array.isArray(program) || program.length === 0) {
    return createEmptyBarrelPolicy();
  }

  const ignoreMatchers = compileIgnoreMatchers([...DEFAULT_IGNORE_GLOBS, ...(options.ignoreGlobs ?? [])]);
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
  const findings: BarrelPolicyFinding[] = [];

  for (const file of activeFiles) {
    checkExportStar(file, findings);
    checkIndexStrictness(file, findings);
  }

  checkMissingIndex(activeFiles, fileSet, findings);

  await checkDeepImports(activeFiles, resolver, workspacePackages, fileSet, findings);

  return {
    findings,
  };
};
