import { describe } from 'bun:test';

import type { FixtureSources } from '../../shared/golden-runner';

import { analyzeCoupling } from '../../../../src/test-api';
import { analyzeDependencies } from '../../../../src/test-api';
import { withTempGildash } from '../../shared/gildash-test-kit';
import { runGolden } from '../../shared/golden-runner';

const gildashAdapter = (_program: ReadonlyArray<unknown>, sources: FixtureSources): Promise<unknown> =>
  withTempGildash(sources, async (gildash, tmpDir) => {
    const deps = await analyzeDependencies(gildash, { rootAbs: tmpDir });

    return analyzeCoupling(deps);
  });

describe('golden/coupling', () => {
  runGolden(import.meta.dir, 'hub-module', gildashAdapter);
  runGolden(import.meta.dir, 'baseline', gildashAdapter);
  runGolden(import.meta.dir, 'two-modules', gildashAdapter);
  runGolden(import.meta.dir, 'isolated', gildashAdapter);
  runGolden(import.meta.dir, 'star-hub', gildashAdapter);
});
