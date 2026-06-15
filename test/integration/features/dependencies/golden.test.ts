import { describe } from 'bun:test';
import { readFileSync } from 'node:fs';

import type { FixtureSources } from '../../shared/golden-runner';

import { analyzeDependencies } from '../../../../src/test-api';
import { withTempGildash } from '../../shared/gildash-test-kit';
import { runGolden } from '../../shared/golden-runner';

const gildashAdapter = (_program: ReadonlyArray<unknown>, sources: FixtureSources): Promise<unknown> =>
  withTempGildash(sources, (gildash, tmpDir) =>
    analyzeDependencies(gildash, {
      rootAbs: tmpDir,
      readFileFn: (p: string) => readFileSync(p, 'utf8'),
    }),
  );

describe('golden/dependencies', () => {
  runGolden(import.meta.dir, 'cycle', gildashAdapter);
  runGolden(import.meta.dir, 'no-cycle', gildashAdapter);
  runGolden(import.meta.dir, 'fan-out', gildashAdapter);
  runGolden(import.meta.dir, 'linear-chain', gildashAdapter);
  runGolden(import.meta.dir, 'no-deps', gildashAdapter);
});
