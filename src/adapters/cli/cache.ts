import { rm } from 'node:fs/promises';
import * as path from 'node:path';

import type { FirebatLogger } from '../../shared/logger';

import { resolveRuntimeContextFromCwd } from '../../shared/runtime-context';

const isTty = (): boolean => Boolean(process.stdout?.isTTY);

const H = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  gray: '\x1b[90m',
  white: '\x1b[37m',
} as const;

const hc = (text: string, code: string, color: boolean): string => (color ? `${code}${text}${H.reset}` : text);

const writeStdout = (text: string): void => {
  process.stdout.write(text + '\n');
};

const printCacheHelp = (): void => {
  const c = isTty();
  const lines = [
    '',
    `  ${hc('\ud83d\udd25 firebat cache', `${H.bold}${H.cyan}`, c)}`,
    '',
    `  ${hc('USAGE', `${H.bold}${H.yellow}`, c)}`,
    '',
    `    ${hc('$', H.dim, c)} firebat cache clean`,
    '',
    `  ${hc('DESCRIPTION', `${H.bold}${H.yellow}`, c)}`,
    '',
    `    Deletes the SQLite cache database files from ${hc('.firebat/', H.green, c)}.`,
    `    The ${hc('.firebat/', H.green, c)} directory itself is preserved.`,
    '',
    `  ${hc('FILES REMOVED', `${H.bold}${H.yellow}`, c)}`,
    '',
    `    ${hc('\u2022', H.dim, c)} ${hc('.firebat/firebat.sqlite', H.gray, c)}`,
    `    ${hc('\u2022', H.dim, c)} ${hc('.firebat/firebat.sqlite-wal', H.gray, c)}`,
    `    ${hc('\u2022', H.dim, c)} ${hc('.firebat/firebat.sqlite-shm', H.gray, c)}`,
    '',
  ];

  writeStdout(lines.join('\n'));
};

const printCacheAndExit = (code: number): number => {
  printCacheHelp();

  return code;
};

const safeRemoveFile = async (filePath: string): Promise<'removed' | 'missing' | 'failed'> => {
  let result: 'removed' | 'missing' | 'failed' = 'missing';
  const hasPath = filePath.trim().length > 0;

  if (!hasPath) {
    return result;
  }

  if (hasPath) {
    try {
      const file = Bun.file(filePath);

      if (await file.exists()) {
        await rm(filePath);

        result = 'removed';
      }
    } catch (err) {
      result = 'failed';
    }
  }

  return result;
};

export const runCache = async (argv: readonly string[], logger: FirebatLogger): Promise<number> => {
  const sub = argv[0] ?? '';
  let exitCode: number | null = null;

  if (sub === '--help' || sub === '-h') {
    exitCode = 0;
  }

  if (sub.length === 0) {
    exitCode = 1;
  }

  if (sub !== 'clean') {
    exitCode = 1;
  }

  if (exitCode !== null) {
    return printCacheAndExit(exitCode);
  }

  logger.debug('cache clean: resolving root');

  const ctx = await resolveRuntimeContextFromCwd();
  const rootAbs = ctx.rootAbs;
  const base = path.join(rootAbs, '.firebat', 'firebat.sqlite');
  const candidates = [base, `${base}-wal`, `${base}-shm`];

  logger.trace('Cache files to check', { candidateCount: candidates.length });

  const removed: string[] = [];
  const missing: string[] = [];
  const failed: string[] = [];

  for (const candidate of candidates) {
    const result = await safeRemoveFile(candidate);

    if (result === 'removed') {
      removed.push(candidate);
    } else if (result === 'missing') {
      missing.push(candidate);
    } else {
      failed.push(candidate);
    }
  }

  if (failed.length > 0) {
    logger.error('cache clean failed: could not remove some cache files (are they in use?)');

    for (const item of failed) {
      logger.error('cache clean failed: remove failed', { filePath: item });
    }

    exitCode = 1;
  }

  logger.info('cache clean done');

  for (const item of removed) {
    logger.info('cache removed', { filePath: item });
  }

  if (removed.length === 0 && missing.length > 0) {
    logger.info('cache already clean');
  }

  return exitCode ?? 0;
};
