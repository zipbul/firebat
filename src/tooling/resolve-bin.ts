import * as path from 'node:path';

interface ResolveLocalBinInput {
  readonly cwd: string;
  readonly binName: string;
  /** Caller file directory (usually `import.meta.dir`) used for package-local fallbacks. */
  readonly callerDir: string;
  /**
   * Tool resolution mode.
   * - default: prefer project-local, then firebat package-local, then PATH
   * - project-only: resolve only from `cwd/node_modules/.bin` (useful for deterministic tests)
   */
  readonly resolveMode?: 'default' | 'project-only';
}

const tryResolveLocalBin = async (input: ResolveLocalBinInput): Promise<string | null> => {
  const mode = input.resolveMode ?? 'default';
  const candidates = [path.resolve(input.cwd, 'node_modules', '.bin', input.binName)];

  if (mode !== 'project-only') {
    // firebat package-local (dist/* sibling to node_modules/*)
    candidates.push(
      path.resolve(input.callerDir, '../../../node_modules', '.bin', input.binName),
      path.resolve(input.callerDir, '../../node_modules', '.bin', input.binName),
    );
  }

  for (const candidate of candidates) {
    try {
      const file = Bun.file(candidate);

      if (await file.exists()) {
        return candidate;
      }
    } catch {
      // ignore
    }
  }

  if (mode !== 'project-only' && typeof Bun.which === 'function') {
    const resolved = Bun.which(input.binName);

    if (resolved !== null && resolved.length > 0) {
      return resolved;
    }
  }

  return null;
};

interface BunxCommand {
  readonly command: string;
  /** Prefix args (e.g. ['x'] when using `bun x` instead of `bunx`). */
  readonly prefixArgs: string[];
}

const tryResolveBunxCommand = (): BunxCommand | null => {
  if (typeof Bun.which !== 'function') {
    return null;
  }

  const bunx = Bun.which('bunx');

  if (bunx !== null && bunx.length > 0) {
    return { command: bunx, prefixArgs: [] };
  }

  const bun = Bun.which('bun');

  if (bun !== null && bun.length > 0) {
    // `bun x` is an alias for bunx.
    return { command: bun, prefixArgs: ['x'] };
  }

  return null;
};

export { tryResolveBunxCommand, tryResolveLocalBin };
export type { BunxCommand, ResolveLocalBinInput };
