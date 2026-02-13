import * as path from 'node:path';

const uniqueSorted = (values: ReadonlyArray<string>): string[] => Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));

const toAbsolutePaths = (cwd: string, filePaths: ReadonlyArray<string>): string[] =>
  uniqueSorted(filePaths.map(filePath => path.resolve(cwd, filePath)));

const runGitLsFiles = (cwd: string, patterns?: ReadonlyArray<string>): string[] | null => {
  const result = Bun.spawnSync({
    cmd: ['git', 'ls-files', ...(patterns ?? [])],
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (result.exitCode !== 0) {
    return null;
  }

  const output = result.stdout.toString('utf8').trim();

  if (output.length === 0) {
    return [];
  }

  return output
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
};

const scanWithGlob = async (cwd: string, patterns: ReadonlyArray<string>): Promise<string[]> => {
  const matches: string[] = [];

  for (const pattern of patterns) {
    const glob = new Bun.Glob(pattern);

    for await (const filePath of glob.scan({ cwd, onlyFiles: true, followSymlinks: false })) {
      matches.push(filePath);
    }
  }

  return uniqueSorted(matches);
};

const normalizePath = (value: string): string => value.replaceAll('\\', '/');

const shouldIncludeSourceFile = (filePath: string): boolean => {
  const normalized = normalizePath(filePath);
  const segments = normalized.split('/');
  const nodeModulesSegment = 'node' + '_modules';

  if (segments.includes(nodeModulesSegment)) {
    return false;
  }

  if (normalized.endsWith('.d.ts')) {
    return false;
  }

  return normalized.endsWith('.ts');
};

const scanDirForSources = async (dirAbs: string): Promise<string[]> => {
  const patterns: ReadonlyArray<string> = ['**/*.ts'];
  const out: string[] = [];

  for (const pattern of patterns) {
    const glob = new Bun.Glob(pattern);

    for await (const relPath of glob.scan({ cwd: dirAbs, onlyFiles: true, followSymlinks: false })) {
      out.push(path.resolve(dirAbs, relPath));
    }
  }

  return uniqueSorted(out).filter(shouldIncludeSourceFile);
};

export const expandTargets = async (targets: ReadonlyArray<string>): Promise<string[]> => {
  const expanded: string[] = [];

  for (const raw of targets) {
    const abs = path.resolve(raw);

    try {
      const stat = await Bun.file(abs).stat();

      if (stat.isDirectory()) {
        const files = await scanDirForSources(abs);

        expanded.push(...files);

        continue;
      }

      if (shouldIncludeSourceFile(abs)) {
        expanded.push(abs);
      }
    } catch {
      // Ignore missing/unreadable entries.
      continue;
    }
  }

  return uniqueSorted(expanded);
};

export const discoverDefaultTargets = async (cwd: string = process.cwd()): Promise<string[]> => {
  const gitAll = runGitLsFiles(cwd);

  if (gitAll !== null) {
    return toAbsolutePaths(cwd, gitAll).filter(shouldIncludeSourceFile);
  }

  const globMatches = await scanWithGlob(cwd, ['**/*.ts']);

  return toAbsolutePaths(cwd, globMatches).filter(shouldIncludeSourceFile);
};

export const resolveTargets = async (cwd: string, targets?: ReadonlyArray<string>): Promise<string[]> => {
  if (targets && targets.length > 0) {
    const absTargets = targets.map(t => (path.isAbsolute(t) ? t : path.resolve(cwd, t)));

    return expandTargets(absTargets);
  }

  const discovered = await discoverDefaultTargets(cwd);

  return expandTargets(discovered);
};
