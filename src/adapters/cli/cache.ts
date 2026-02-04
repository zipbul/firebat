import * as path from 'node:path';
import { rm } from 'node:fs/promises';

import { resolveRuntimeContextFromCwd } from '../../runtime-context';

const printCacheHelp = (): void => {
  const lines = [
    'firebat cache',
    '',
    'Usage:',
    '  firebat cache clean',
    '',
    'Notes:',
    '  - Keeps the .firebat/ directory but deletes the SQLite cache DB files.',
  ];

  console.log(lines.join('\n'));
};

const safeRemoveFile = async (filePath: string): Promise<'removed' | 'missing' | 'failed'> => {
  try {
    const file = Bun.file(filePath);

    if (!(await file.exists())) {
      return 'missing';
    }

    await rm(filePath);

    return 'removed';
  } catch {
    return 'failed';
  }
};

export const runCache = async (argv: readonly string[]): Promise<number> => {
  const sub = argv[0] ?? '';

  if (sub === '--help' || sub === '-h' || sub.length === 0) {
    printCacheHelp();

    return sub.length === 0 ? 1 : 0;
  }

  if (sub !== 'clean') {
    printCacheHelp();

    return 1;
  }

  const ctx = await resolveRuntimeContextFromCwd();
  const rootAbs = ctx.rootAbs;
  const base = path.join(rootAbs, '.firebat', 'firebat.sqlite');
  const candidates = [base, `${base}-wal`, `${base}-shm`];

  const removed: string[] = [];
  const missing: string[] = [];
  const failed: string[] = [];

  for (const candidate of candidates) {
    const result = await safeRemoveFile(candidate);

    if (result === 'removed') removed.push(candidate);
    else if (result === 'missing') missing.push(candidate);
    else failed.push(candidate);
  }

  if (failed.length > 0) {
    console.error('[firebat] cache clean failed: could not remove some cache files (are they in use?)');

    for (const item of failed) {
      console.error(`[firebat]  - ${item}`);
    }

    return 1;
  }

  console.log('[firebat] cache clean done');

  for (const item of removed) {
    console.log(`[firebat] removed ${item}`);
  }

  if (removed.length === 0 && missing.length > 0) {
    console.log('[firebat] cache already clean');
  }

  return 0;
};
