import { describe } from 'bun:test';

import { analyzeDependencies } from '../../../../src/test-api';
import type { FixtureSources } from '../../shared/golden-runner';
import { runGolden } from '../../shared/golden-runner';
import { createTempGildash } from '../../shared/gildash-test-kit';

const gildashAdapter = async (
  _program: ReadonlyArray<unknown>,
  sources: FixtureSources,
): Promise<unknown> => {
  const { gildash, tmpDir, cleanup } = await createTempGildash(sources);

  try {
    return await analyzeDependencies(gildash, { rootAbs: tmpDir });
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
