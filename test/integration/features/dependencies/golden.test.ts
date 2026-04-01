import { describe } from 'bun:test';
import { readFileSync } from 'node:fs';

import type { FixtureSources } from '../../shared/golden-runner';

import { analyzeDependencies } from '../../../../src/test-api';
import { createTempGildash } from '../../shared/gildash-test-kit';
import { runGolden } from '../../shared/golden-runner';

const gildashAdapter = async (_program: ReadonlyArray<unknown>, sources: FixtureSources): Promise<unknown> => {
  const { gildash, tmpDir, cleanup } = await createTempGildash(sources);

  try {
    return await analyzeDependencies(gildash, {
      rootAbs: tmpDir,
      readFileFn: (p: string) => readFileSync(p, 'utf8'),
    });
  } finally {
    await cleanup();
  }
};

describe('golden/dependencies', () => {
  runGolden(import.meta.dir, 'cycle', gildashAdapter);
  runGolden(import.meta.dir, 'no-cycle', gildashAdapter);
  runGolden(import.meta.dir, 'fan-out', gildashAdapter);
  runGolden(import.meta.dir, 'linear-chain', gildashAdapter);
  runGolden(import.meta.dir, 'no-deps', gildashAdapter);
});
