import { normalizePath } from '@zipbul/gildash';
import * as path from 'node:path';

import { asRecord, isStringArray, readJsoncFile } from '../../shared';

type TsconfigPaths = Record<string, ReadonlyArray<string>>;

interface TsconfigResolveOptions {
  readonly tsconfigDirAbs: string;
  readonly baseUrlAbs: string;
  readonly paths: TsconfigPaths;
}

type WorkspacePackages = ReadonlyMap<string, string>; // name -> rootAbs

interface ResolverInput {
  readonly rootAbs: string;
  readonly fileSet: ReadonlySet<string>; // normalized absolute
  readonly workspacePackages: WorkspacePackages;
}

interface TsconfigOptions {
  readonly baseUrl?: string;
  readonly paths?: TsconfigPaths;
}

interface StarMatch {
  readonly star: string;
}

const isWithinRoot = (rootAbs: string, fileAbs: string): boolean => {
  const rel = path.relative(rootAbs, fileAbs);

  return rel.length === 0 || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

const resolveExtendsPath = (fromDirAbs: string, extendsValue: string): string | null => {
  const trimmed = extendsValue.trim();

  if (trimmed.length === 0) {
    return null;
  }

  // We intentionally do not guess package-based extends (e.g. "@tsconfig/node18/tsconfig.json").
  if (!trimmed.startsWith('.') && !trimmed.startsWith('/')) {
    return null;
  }

  const abs = path.resolve(fromDirAbs, trimmed);

  if (abs.endsWith('.json')) {
    return abs;
  }

  return `${abs}.json`;
};

const mergePaths = (base: TsconfigPaths, override: TsconfigPaths): TsconfigPaths => {
  return {
    ...base,
    ...override,
  };
};

const loadTsconfigOptions = async (tsconfigPathAbs: string, seen: Set<string>): Promise<TsconfigOptions | null> => {
  const normalized = normalizePath(tsconfigPathAbs);

  if (seen.has(normalized)) {
    return null;
  }

  seen.add(normalized);

  const parsed = await readJsoncFile(tsconfigPathAbs);

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const parsedRecord = asRecord(parsed);
  const rawExtends = parsedRecord?.extends;
  const rawCompilerOptions = parsedRecord?.compilerOptions;
  const compilerOptions = rawCompilerOptions && typeof rawCompilerOptions === 'object' ? rawCompilerOptions : null;
  const baseUrl =
    compilerOptions && typeof asRecord(compilerOptions)?.baseUrl === 'string'
      ? (asRecord(compilerOptions)?.baseUrl as string)
      : undefined;
  const rawPaths =
    compilerOptions && typeof asRecord(compilerOptions)?.paths === 'object' ? asRecord(compilerOptions)?.paths : undefined;
  const pathsValue: TsconfigPaths | undefined = rawPaths
    ? Object.fromEntries(
        Object.entries(asRecord(rawPaths) ?? {})
          .filter(([key, value]) => typeof key === 'string' && isStringArray(value))
          .map(([key, value]) => [key, value as ReadonlyArray<string>]),
      )
    : undefined;
  let inherited: TsconfigOptions | null = null;

  if (typeof rawExtends === 'string') {
    const parentPath = resolveExtendsPath(path.dirname(tsconfigPathAbs), rawExtends);

    if (parentPath) {
      inherited = await loadTsconfigOptions(parentPath, seen);
    }
  }

  const mergedBaseUrl = baseUrl ?? inherited?.baseUrl;
  const mergedPaths = mergePaths(inherited?.paths ?? {}, pathsValue ?? {});

  return {
    ...(mergedBaseUrl !== undefined ? { baseUrl: mergedBaseUrl } : {}),
    ...(Object.keys(mergedPaths).length > 0 ? { paths: mergedPaths } : {}),
  };
};

const findNearestTsconfig = async (rootAbs: string, fromDirAbs: string): Promise<string | null> => {
  let current = path.resolve(fromDirAbs);

  while (isWithinRoot(rootAbs, current)) {
    const candidate = path.join(current, 'tsconfig.json');

    // `.exists()` returns false for every "not found" condition (missing file,
    // ENOTDIR, EACCES); it only throws on a malformed path argument (null byte,
    // ENAMETOOLONG), which is an upstream bug that should surface, not be masked.
    if (await Bun.file(candidate).exists()) {
      return candidate;
    }

    const parent = path.dirname(current);

    if (parent === current) {
      break;
    }

    current = parent;
  }

  return null;
};

const compileTsconfigResolveOptions = async (
  rootAbs: string,
  importerFileAbs: string,
): Promise<TsconfigResolveOptions | null> => {
  const importerDirAbs = path.dirname(importerFileAbs);
  const tsconfigPathAbs = await findNearestTsconfig(rootAbs, importerDirAbs);

  if (!tsconfigPathAbs) {
    return null;
  }

  const opts = await loadTsconfigOptions(tsconfigPathAbs, new Set());

  if (!opts) {
    return null;
  }

  const tsconfigDirAbs = path.dirname(tsconfigPathAbs);
  const baseUrlAbs = path.resolve(tsconfigDirAbs, opts.baseUrl ?? '.');

  return {
    tsconfigDirAbs,
    baseUrlAbs,
    paths: opts.paths ?? {},
  };
};

const matchStarPattern = (pattern: string, specifier: string): StarMatch | null => {
  if (!pattern.includes('*')) {
    return pattern === specifier ? { star: '' } : null;
  }

  const starIndex = pattern.indexOf('*');
  const prefix = pattern.slice(0, starIndex);
  const suffix = pattern.slice(starIndex + 1);

  if (!specifier.startsWith(prefix)) {
    return null;
  }

  if (!specifier.endsWith(suffix)) {
    return null;
  }

  // tsc guard (`matchPatternOrExact`): the wildcard region must have
  // non-negative length. Without this, an overlapping prefix/suffix (e.g.
  // pattern `lib/*/util` against specifier `lib/util`) produces a false
  // match with an empty star via `.slice()`'s start>end clamping.
  if (specifier.length < prefix.length + suffix.length) {
    return null;
  }

  const middle = specifier.slice(prefix.length, specifier.length - suffix.length);

  return { star: middle };
};

/** Literal prefix length before the first `*` (or the whole key, for an exact pattern). */
const literalPrefixLength = (pattern: string): number => {
  const starIndex = pattern.indexOf('*');

  return starIndex === -1 ? pattern.length : starIndex;
};

/**
 * TS `paths` precedence (tsc `tryParsePatterns`): an exact pattern (no `*`)
 * always beats a wildcard pattern; among wildcard patterns, the one with the
 * longest matched literal prefix (the text before `*`) wins. Ties break on
 * DECLARATION order (Object.entries insertion order) — `Array.prototype.sort`
 * is spec-guaranteed stable, so returning 0 on a tie preserves it. A
 * lexicographic key-string tie-break would be wrong: it can reorder two
 * patterns relative to their declaration order (F1).
 */
const comparePathPatternPrecedence = ([keyA]: readonly [string, unknown], [keyB]: readonly [string, unknown]): number => {
  const isExactA = !keyA.includes('*');
  const isExactB = !keyB.includes('*');

  if (isExactA !== isExactB) {
    return isExactA ? -1 : 1;
  }

  if (!isExactA) {
    const prefixDelta = literalPrefixLength(keyB) - literalPrefixLength(keyA);

    if (prefixDelta !== 0) {
      return prefixDelta;
    }
  }

  return 0;
};

/** Order `paths` entries by TS precedence — exact keys first, then wildcards by descending literal-prefix length. */
const sortPathPatternEntries = (paths: TsconfigPaths): ReadonlyArray<[string, ReadonlyArray<string>]> =>
  Object.entries(paths).sort(comparePathPatternPrecedence);

const applyStarPattern = (pattern: string, star: string): string => {
  if (!pattern.includes('*')) {
    return pattern;
  }

  return pattern.replace('*', star);
};

const resolveFromFileSet = (baseAbs: string, fileSet: ReadonlySet<string>): string | null => {
  const candidates = [baseAbs, `${baseAbs}.ts`, path.join(baseAbs, 'index.ts')];

  for (const candidate of candidates) {
    const normalized = normalizePath(candidate);

    if (fileSet.has(normalized)) {
      return normalized;
    }
  }

  return null;
};

const resolveRelative = (importerFileAbs: string, specifier: string, fileSet: ReadonlySet<string>): string | null => {
  if (!specifier.startsWith('.')) {
    return null;
  }

  const base = path.resolve(path.dirname(importerFileAbs), specifier);

  return resolveFromFileSet(base, fileSet);
};

const resolveWorkspace = (
  specifier: string,
  workspacePackages: WorkspacePackages,
  fileSet: ReadonlySet<string>,
): string | null => {
  for (const [pkgName, pkgRootAbs] of workspacePackages.entries()) {
    if (specifier === pkgName) {
      const resolved = resolveFromFileSet(pkgRootAbs, fileSet);

      if (resolved) {
        return resolved;
      }
      continue;
    }

    if (specifier.startsWith(`${pkgName}/`)) {
      const rest = specifier.slice(pkgName.length + 1);
      const base = path.join(pkgRootAbs, rest);
      const resolved = resolveFromFileSet(base, fileSet);

      if (resolved) {
        return resolved;
      }
      continue;
    }
  }

  return null;
};

const resolveAlias = async (
  rootAbs: string,
  importerFileAbs: string,
  specifier: string,
  fileSet: ReadonlySet<string>,
  cache: Map<string, TsconfigResolveOptions | null>,
): Promise<string | null> => {
  const cacheKey = normalizePath(path.dirname(importerFileAbs));
  let compiled = cache.get(cacheKey);

  if (compiled === undefined) {
    compiled = await compileTsconfigResolveOptions(rootAbs, importerFileAbs);

    cache.set(cacheKey, compiled);
  }

  if (!compiled) {
    return null;
  }

  const entries = sortPathPatternEntries(compiled.paths);

  // tsc's `matchPatternOrExact` selects EXACTLY ONE pattern (the first match
  // in precedence order) and tries ONLY that pattern's target array. If none
  // of its substitutions resolve, paths resolution FAILS — there is no
  // fall-through to a lower-precedence pattern (F1).
  for (const [keyPattern, targets] of entries) {
    const match = matchStarPattern(keyPattern, specifier);

    if (!match) {
      continue;
    }

    for (const targetPattern of targets) {
      const replaced = applyStarPattern(targetPattern, match.star);
      const base = path.resolve(compiled.baseUrlAbs, replaced);
      const resolved = resolveFromFileSet(base, fileSet);

      if (resolved) {
        return resolved;
      }
    }

    return null;
  }

  return null;
};

interface ImportResolver {
  readonly resolve: (importerFileAbs: string, specifier: string) => Promise<string | null>;
}

const createImportResolver = (input: ResolverInput): ImportResolver => {
  const tsconfigCache = new Map<string, TsconfigResolveOptions | null>();

  return {
    resolve: async (importerFileAbs: string, specifier: string) => {
      const normalizedImporter = normalizePath(importerFileAbs);
      const relResolved = resolveRelative(normalizedImporter, specifier, input.fileSet);

      if (relResolved) {
        return relResolved;
      }

      // F6: tsc consults tsconfig `paths` BEFORE workspace/node_modules
      // resolution — alias resolution must run first.
      const aliasResolved = await resolveAlias(input.rootAbs, normalizedImporter, specifier, input.fileSet, tsconfigCache);

      if (aliasResolved) {
        return aliasResolved;
      }

      const wsResolved = resolveWorkspace(specifier, input.workspacePackages, input.fileSet);

      if (wsResolved) {
        return wsResolved;
      }

      return null;
    },
  };
};

export { createImportResolver };
export type { ImportResolver };
