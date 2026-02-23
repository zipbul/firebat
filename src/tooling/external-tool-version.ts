import type { FirebatLogger } from '../shared/logger';

interface ExternalToolVersionInput {
  readonly tool: string;
  readonly cmdPath: string;
  readonly cwd: string;
  readonly minVersion: string;
  readonly logger: FirebatLogger;
}

const cache = new Map<string, { raw: string; parsed?: string } | null>();

const extractSemver = (raw: string): string | undefined => {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(raw);

  return match ? `${match[1]}.${match[2]}.${match[3]}` : undefined;
};

const compareSemver = (left: string, right: string): number => {
  const parse = (value: string): [number, number, number] => {
    const match = /(\d+)\.(\d+)\.(\d+)/.exec(value);

    if (!match) {
      return [0, 0, 0];
    }

    return [Number(match[1]) || 0, Number(match[2]) || 0, Number(match[3]) || 0];
  };

  const [l0, l1, l2] = parse(left);
  const [r0, r1, r2] = parse(right);

  if (l0 !== r0) {
    return l0 < r0 ? -1 : 1;
  }

  if (l1 !== r1) {
    return l1 < r1 ? -1 : 1;
  }

  if (l2 !== r2) {
    return l2 < r2 ? -1 : 1;
  }

  return 0;
};

export const logExternalToolVersionOnce = async (input: ExternalToolVersionInput): Promise<void> => {
  const key = `${input.tool}:${input.cmdPath}`;

  if (cache.has(key)) {
    return;
  }

  try {
    const proc = Bun.spawn({
      cmd: [input.cmdPath, '--version'],
      cwd: input.cwd,
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const raw = (stdout.trim().length > 0 ? stdout : stderr).trim();
    const parsed = raw.length > 0 ? extractSemver(raw) : undefined;

    cache.set(key, raw.length > 0 ? { raw, ...(parsed ? { parsed } : {}) } : null);

    input.logger.debug(`${input.tool}: version resolved`, {
      cmd: input.cmdPath,
      exitCode,
      raw,
      ...(parsed ? { parsed } : {}),
    });

    if (parsed && compareSemver(parsed, input.minVersion) < 0) {
      input.logger.warn(`${input.tool}: version below minimum`, {
        minVersion: input.minVersion,
        version: parsed,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    cache.set(key, null);

    input.logger.warn(`${input.tool}: failed to resolve version`, { message });
  }
};
