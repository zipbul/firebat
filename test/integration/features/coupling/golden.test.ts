import { describe } from 'bun:test';

import type { FixtureSources } from '../../shared/golden-runner';

import { analyzeCoupling } from '../../../../src/test-api';
import { analyzeDependencies } from '../../../../src/test-api';
import { createTempGildash } from '../../shared/gildash-test-kit';
import { runGolden } from '../../shared/golden-runner';

const gildashAdapter = async (_program: ReadonlyArray<unknown>, sources: FixtureSources): Promise<unknown> => {
  const { gildash, tmpDir, cleanup } = await createTempGildash(sources);

  try {
    const deps = await analyzeDependencies(gildash, { rootAbs: tmpDir });

    return analyzeCoupling(deps);
  } finally {
    await cleanup();
  }
};

describe('golden/coupling', () => {
  runGolden(import.meta.dir, 'hub-module', gildashAdapter);
  runGolden(import.meta.dir, 'baseline', gildashAdapter);
  runGolden(import.meta.dir, 'two-modules', gildashAdapter);
  runGolden(import.meta.dir, 'isolated', gildashAdapter);
  runGolden(import.meta.dir, 'star-hub', gildashAdapter);
});
