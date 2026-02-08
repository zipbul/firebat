import * as path from 'node:path';

import type { FirebatLogger } from '../../ports/logger';

import { tryResolveLocalBin } from '../tooling/resolve-bin';

interface OxfmtRunResult {
  readonly ok: boolean;
  readonly tool: 'oxfmt';
  readonly exitCode?: number;
  readonly error?: string;
  readonly rawStdout?: string;
  readonly rawStderr?: string;
}

interface RunOxfmtInput {
  readonly targets: ReadonlyArray<string>;
  readonly configPath?: string;
  readonly mode: 'check' | 'write';
  /** Working directory used to resolve project-local binaries. Defaults to process.cwd(). */
  readonly cwd?: string;
  readonly logger: FirebatLogger;
}

const runOxfmt = async (input: RunOxfmtInput): Promise<OxfmtRunResult> => {
  const { logger } = input;
  const cwd = input.cwd ?? process.cwd();

  logger.debug('oxfmt: resolving command');

  const resolved = await tryResolveLocalBin({ cwd, binName: 'oxfmt', callerDir: import.meta.dir });

  if (!resolved || resolved.length === 0) {
    logger.warn('oxfmt: command not found — format tool unavailable');

    return {
      ok: false,
      tool: 'oxfmt',
      error: 'oxfmt is not available. Install it (or use a firebat build that bundles it) to enable the format tool.',
    };
  }

  logger.trace('oxfmt: resolved command', { cmd: resolved, cwd });

  const args: string[] = [];

  if (input.configPath !== undefined && input.configPath.trim().length > 0) {
    args.push('--config', input.configPath);
  }

  if (input.mode === 'check') {
    args.push('--check');
  } else {
    // Explicitly request in-place writes (documented default, but keeping explicit for clarity).
    args.push('--write');
  }

  args.push(...input.targets);

  logger.debug('oxfmt: spawning process', { mode: input.mode, targetCount: input.targets.length });

  try {
    const proc = Bun.spawn({
      cmd: [resolved, ...args],
      cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    logger.debug('oxfmt: process exited', { exitCode });

    return {
      ok: true,
      tool: 'oxfmt',
      exitCode,
      rawStdout: stdout,
      rawStderr: stderr,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    logger.error(`oxfmt: spawn failed: ${message}`, undefined, err);

    return {
      ok: false,
      tool: 'oxfmt',
      error: message,
    };
  }
};

export { runOxfmt };
export type { OxfmtRunResult, RunOxfmtInput };
