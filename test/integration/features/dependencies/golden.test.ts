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
  readonly entry?: ReadonlyArray<string>;
  readonly ignore?: ReadonlyArray<string>;
}

const gildashAdapter =
  (opts: DepFixtureOptions = {}) =>
  (_program: ReadonlyArray<unknown>, sources: FixtureSources): Promise<unknown> =>
    withTempGildash(sources, (gildash, tmpDir) =>
      analyzeDependencies(gildash, {
        rootAbs: tmpDir,
        // Model an installed project: dep manifests under node_modules are readable with no
        // `bin` (pure libraries), so unused-dependency resolves to a definite verdict instead
        // of 'unknown' (which the temp fixture — with no real node_modules — would otherwise
        // yield, holding every candidate). Real project files fall through to the filesystem.
        readFileFn: (p: string): string =>
          /\/node_modules\/(@[^/]+\/)?[^/]+\/package\.json$/.test(p) ? '{}' : readFileSync(p, 'utf8'),
        ...(opts.layers === undefined ? {} : { layers: opts.layers }),
        ...(opts.allowedDependencies === undefined ? {} : { allowedDependencies: opts.allowedDependencies }),
        ...(opts.ignoreDependencies === undefined ? {} : { ignoreDependencies: opts.ignoreDependencies }),
        ...(opts.entry === undefined ? {} : { entry: opts.entry }),
        ...(opts.ignore === undefined ? {} : { ignore: opts.ignore }),
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
  // unused-file is opt-in: the user declares the entry set (here index + spec files as roots).
  rg('unused-file', { entry: ['**/index.ts', '**/*.spec.ts'] });
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
  // K: same shape as layer-violation but layers unconfigured → whole check inactive.
  rg('layer-unconfigured');
  // K: no package.json main and no test/config entry files → zero entry points →
  // unused-file judgment is held (orphan file must NOT be reported).
  rg('unused-file-no-entry');
});
