import { describe } from 'bun:test';
import { readFileSync } from 'node:fs';

import type { DependencyLayerRule } from '../../../../src/shared/dependency-layer-rule';
import type { FixtureSources } from '../../shared/golden-runner';

import { analyzeDependencies } from '../../../../src/test-api';
import { withTempGildash } from '../../shared/gildash-test-kit';
import { runGolden } from '../../shared/golden-runner';

interface DepFixtureOptions {
  readonly layers?: ReadonlyArray<DependencyLayerRule>;
  readonly allowedDependencies?: Readonly<Record<string, ReadonlyArray<string>>>;
  readonly ignoreDependencies?: ReadonlyArray<string>;
}

const gildashAdapter =
  (opts: DepFixtureOptions = {}) =>
  (_program: ReadonlyArray<unknown>, sources: FixtureSources): Promise<unknown> =>
    withTempGildash(sources, (gildash, tmpDir) =>
      analyzeDependencies(gildash, {
        rootAbs: tmpDir,
        readFileFn: (p: string) => readFileSync(p, 'utf8'),
        ...(opts.layers === undefined ? {} : { layers: opts.layers }),
        ...(opts.allowedDependencies === undefined ? {} : { allowedDependencies: opts.allowedDependencies }),
        ...(opts.ignoreDependencies === undefined ? {} : { ignoreDependencies: opts.ignoreDependencies }),
      }),
    );

describe('golden/dependencies', () => {
  const rg = (name: string, opts: DepFixtureOptions = {}) => runGolden(import.meta.dir, name, gildashAdapter(opts));

  rg('cycle');
  rg('no-cycle');
  rg('fan-out');
  rg('linear-chain');
  rg('no-deps');

  // ── kind coverage (dependencies detector W/K) ──────────────────────────────
  rg('dead-export');
  rg('unused-file');
  rg('test-only-export');
  rg('unused-ns-member');
  rg('circular-indirect');
  rg('unused-dependency');
  rg('unlisted-dependency');
  rg('unresolved-import');
  rg('duplicate-export-k');
  rg('layer-violation', {
    layers: [
      { name: 'ui', glob: 'layer-violation/ui/**' },
      { name: 'domain', glob: 'layer-violation/domain/**' },
    ],
    allowedDependencies: { ui: ['domain'] },
  });
});
