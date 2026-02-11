import * as path from 'node:path';

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

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  return value as Record<string, unknown>;
};

const normalizePath = (value: string): string => value.replaceAll('\\', '/');

const isWithinRoot = (rootAbs: string, fileAbs: string): boolean => {
  const rel = path.relative(rootAbs, fileAbs);

  return rel.length === 0 || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

const readJsoncFile = async (filePathAbs: string): Promise<unknown | null> => {
  try {
    const file = Bun.file(filePathAbs);

    if (!(await file.exists())) {
      return null;
    }

    const text = await file.text();

    return Bun.JSONC.parse(text);
  } catch {
    return null;
  }
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
          .filter(([key, value]) => typeof key === 'string' && Array.isArray(value) && value.every(v => typeof v === 'string'))
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

    try {
      if (await Bun.file(candidate).exists()) {
        return candidate;
      }
    } catch {
      // ignore
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

  const middle = specifier.slice(prefix.length, specifier.length - suffix.length);

  return { star: middle };
};

const applyStarPattern = (pattern: string, star: string): string => {
  if (!pattern.includes('*')) {
    return pattern;
  }

  return pattern.replace('*', star);
};

const resolveFromFileSet = (baseAbs: string, fileSet: ReadonlySet<string>): string | null => {
  const candidates = [
    baseAbs,
    `${baseAbs}.ts`,
    `${baseAbs}.tsx`,
    path.join(baseAbs, 'index.ts'),
    path.join(baseAbs, 'index.tsx'),
  ];

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

  const entries = Object.entries(compiled.paths);

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

      const wsResolved = resolveWorkspace(specifier, input.workspacePackages, input.fileSet);

      if (wsResolved) {
        return wsResolved;
      }

      const aliasResolved = await resolveAlias(input.rootAbs, normalizedImporter, specifier, input.fileSet, tsconfigCache);

      if (aliasResolved) {
        return aliasResolved;
      }

      return null;
    },
  };
};

const createWorkspacePackageMap = async (rootAbs: string): Promise<Map<string, string>> => {
  const pkgJsonPath = path.join(rootAbs, 'package.json');
  const parsed = await readJsoncFile(pkgJsonPath);

  if (!parsed || typeof parsed !== 'object') {
    return new Map();
  }

  const parsedRecord = asRecord(parsed);
  const workspacesRaw = parsedRecord?.workspaces;
  let patterns: string[] = [];

  if (Array.isArray(workspacesRaw) && workspacesRaw.every(v => typeof v === 'string')) {
    patterns = workspacesRaw as string[];
  } else if (workspacesRaw && typeof workspacesRaw === 'object') {
    const packages = asRecord(workspacesRaw)?.packages;

    if (Array.isArray(packages) && packages.every(v => typeof v === 'string')) {
      patterns = packages as string[];
    }
  }

  if (patterns.length === 0) {
    return new Map();
  }

  const packageJsonPaths: string[] = [];

  for (const pattern of patterns) {
    const glob = new Bun.Glob(normalizePath(path.join(pattern, 'package.json')));

    for await (const rel of glob.scan({ cwd: rootAbs, onlyFiles: true, followSymlinks: false })) {
      packageJsonPaths.push(path.resolve(rootAbs, rel));
    }
  }

  const map = new Map<string, string>();

  for (const p of packageJsonPaths) {
    const pkg = await readJsoncFile(p);
    const name = typeof asRecord(pkg)?.name === 'string' ? String(asRecord(pkg)?.name) : '';

    if (name.length === 0) {
      continue;
    }

    map.set(name, path.dirname(p));
  }

  return map;
};

export { createImportResolver, createWorkspacePackageMap };
export type { ImportResolver };
